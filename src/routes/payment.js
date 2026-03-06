'use strict';

const express = require('express');
const { Op } = require('sequelize');
const validator = require('validator');
const { PurchaseHistory, sequelize } = require('../../models');
const { requireLogin } = require('../middlewares/auth');
const { statusCheckLimiter } = require('../middlewares/rateLimiters');
const { sanitizeInput, isValidCPF, isValidEmail, isValidPhone } = require('../middlewares/validation');
const {
    getActivePaymentGateway,
    createCiabraCustomer,
    createCiabraInvoice,
    generateCiabraPixWithAutomation,
    generateQrCodeBase64,
    pixCodesCache,
    addDebugLog,
    CIABRA_PUBLIC_KEY,
    CIABRA_PRIVATE_KEY,
    CIABRA_WEBHOOK_URL
} = require('../services/ciabraService');
const { sendPushNotification } = require('../services/firebaseService');

const router = express.Router();

function getApplyCsrf(req) {
    return req.app.get('applyCsrf');
}

// POST /gerarqrcode — gera QR Code PIX via CIABRA
router.post('/gerarqrcode', (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { value, telefone, cpf, productTitle, productDescription } = req.body;
        const nome = sanitizeInput(req.body.nome);
        const email = sanitizeInput(req.body.email);

        if (!value || !nome || !telefone || !cpf || !email) {
            return res.status(400).json({ error: 'Todos os campos, incluindo e-mail, são obrigatórios.' });
        }
        if (nome.length < 3) {
            return res.status(400).json({ error: 'Nome inválido ou contém caracteres não permitidos.' });
        }
        if (!isValidCPF(cpf)) {
            return res.status(400).json({ error: 'CPF inválido. Por favor, verifique o número digitado.' });
        }
        if (!validator.isEmail(email)) {
            return res.status(400).json({ error: 'E-mail inválido. Por favor, verifique o endereço digitado.' });
        }
        const sanitizedEmail = validator.normalizeEmail(email);
        if (!isValidPhone(telefone)) {
            return res.status(400).json({ error: 'Telefone inválido. Deve conter 11 dígitos (DDD + número).' });
        }
        if (isNaN(value) || value <= 0) {
            return res.status(400).json({ error: 'Valor do produto inválido.' });
        }

        // Verificação de tentativas de compra
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const attemptsLastHour = await PurchaseHistory.count({ where: { telefone, dataTransacao: { [Op.gte]: oneHourAgo } } });
        const attemptsLastMonth = await PurchaseHistory.count({ where: { telefone, dataTransacao: { [Op.gte]: oneMonthAgo } } });
        if (attemptsLastHour >= 3 || attemptsLastMonth >= 5) {
            return res.status(429).json({ error: 'Você já tentou pagar muitas vezes, procure seu vendedor ou tente novamente depois de algumas horas.' });
        }

        const t = await sequelize.transaction();
        try {
            const purchaseRecord = await PurchaseHistory.create(
                { nome, telefone, status: 'Gerado', valorPago: value },
                { transaction: t }
            );

            const expirationDate = new Date();
            expirationDate.setMinutes(expirationDate.getMinutes() + 30);
            const pad = (num) => String(num).padStart(2, '0');
            const dueDateFormatted = `${expirationDate.getFullYear()}-${pad(expirationDate.getMonth() + 1)}-${pad(expirationDate.getDate())} ${pad(expirationDate.getHours())}:${pad(expirationDate.getMinutes())}:${pad(expirationDate.getSeconds())}`;
            void dueDateFormatted;

            const activeGateway = await getActivePaymentGateway();
            console.log(`[GERARQRCODE] 🏦 Gateway ativo: ${activeGateway}`);

            let transactionIdResult;
            let qrCodeResult;
            let qrCodeBase64Result;
            let ciabraInstallmentId = null;

            if (activeGateway === 'ciabra') {
                console.log('[CIABRA DEBUG] ====== INÍCIO DO PROCESSAMENTO ======');

                let valueInCents;
                if (typeof value === 'string') { valueInCents = parseInt(value, 10); }
                else if (typeof value === 'number') { valueInCents = Math.round(value); }
                else { throw new Error(`Tipo de valor inválido: ${typeof value}`); }

                if (isNaN(valueInCents) || valueInCents <= 0) {
                    throw new Error(`Valor do produto inválido: ${value} -> ${valueInCents}`);
                }

                const ciabraPrice = Number((valueInCents / 100).toFixed(2));
                if (isNaN(ciabraPrice) || ciabraPrice <= 0) {
                    throw new Error(`Preço calculado inválido: ${ciabraPrice}`);
                }

                const cleanPhone = telefone ? String(telefone).replace(/\D/g, '') : undefined;
                const cleanDocument = cpf ? String(cpf).replace(/\D/g, '') : undefined;
                const cleanDescription = `${productTitle || 'Produto'} - ${productDescription || ''}`.trim().substring(0, 100);

                const customerDataForCreation = { fullName: String(nome), email: String(sanitizedEmail), document: cleanDocument };
                if (cleanPhone) customerDataForCreation.phone = cleanPhone;

                console.log('[CIABRA DEBUG] Criando cliente no CIABRA...');
                const customerResponse = await createCiabraCustomer(customerDataForCreation);
                const customerId = customerResponse.id;
                console.log(`[CIABRA DEBUG] Cliente criado com ID: ${customerId}`);

                const ciabraPayload = {
                    customerId,
                    description: cleanDescription,
                    dueDate: expirationDate.toISOString(),
                    installmentCount: 1,
                    invoiceType: 'SINGLE',
                    items: [],
                    price: ciabraPrice,
                    externalId: String(purchaseRecord.id),
                    paymentTypes: ['PIX'],
                    notifications: [],
                    webhooks: [
                        { hookType: 'PAYMENT_CONFIRMED', url: CIABRA_WEBHOOK_URL },
                        { hookType: 'PAYMENT_GENERATED', url: CIABRA_WEBHOOK_URL }
                    ]
                };

                console.log('[CIABRA DEBUG] ====== PAYLOAD FINAL ======');
                console.log(JSON.stringify(ciabraPayload, null, 2));

                const ciabraResponse = await createCiabraInvoice(ciabraPayload);
                transactionIdResult = ciabraResponse.id;

                let pixPaymentData = null;
                if (ciabraResponse.installments && ciabraResponse.installments.length > 0) {
                    const installmentId = ciabraResponse.installments[0].id;
                    ciabraInstallmentId = installmentId;
                    console.log('[CIABRA DEBUG] InstallmentId encontrado:', installmentId);

                    try {
                        addDebugLog('[CIABRA] Iniciando automação Puppeteer...');
                        pixPaymentData = await generateCiabraPixWithAutomation(installmentId);
                        if (pixPaymentData) {
                            addDebugLog('[CIABRA] ✅ Código PIX gerado com sucesso!');
                        } else {
                            addDebugLog('[CIABRA] ❌ Falha ao gerar código PIX');
                        }
                    } catch (pixError) {
                        addDebugLog(`[CIABRA] ❌ Erro: ${pixError.message}`);
                        console.error('[CIABRA DEBUG] Erro ao gerar pagamento PIX:', pixError.message);
                    }
                } else {
                    console.error('[CIABRA DEBUG] InstallmentId não encontrado na resposta do invoice');
                }

                if (pixPaymentData) {
                    qrCodeResult = pixPaymentData.emv || pixPaymentData.pixCode || pixPaymentData.code;
                    qrCodeBase64Result = pixPaymentData.qrCodeBase64 || pixPaymentData.base64 || null;
                } else {
                    if (ciabraResponse.installments && ciabraResponse.installments.length > 0) {
                        const installment = ciabraResponse.installments[0];
                        if (installment.payments && installment.payments.length > 0) {
                            const payment = installment.payments[0];
                            qrCodeResult = payment.emv || payment.pixCode || payment.code;
                            qrCodeBase64Result = payment.qrCodeBase64 || payment.base64;
                        }
                    }
                }

                if (qrCodeResult && !qrCodeBase64Result) {
                    try {
                        qrCodeBase64Result = await generateQrCodeBase64(qrCodeResult);
                        console.log('[CIABRA DEBUG] ✅ QR Code gerado com sucesso!');
                    } catch (qrError) {
                        console.error('[CIABRA DEBUG] ❌ Erro ao gerar QR Code:', qrError.message);
                    }
                }
            }

            await purchaseRecord.update(
                { transactionId: transactionIdResult, paymentGateway: activeGateway },
                { transaction: t }
            );

            await t.commit();
            console.log('[GERARQRCODE] ✅ Transação commitada com sucesso!');

            sendPushNotification('Nova Tentativa de Venda!', `${nome} gerou um QR Code para pagamento.`);

            const resultado = {
                id: transactionIdResult,
                qr_code: qrCodeResult,
                qr_code_base64: qrCodeBase64Result,
                expirationTimestamp: expirationDate.getTime(),
                gateway: activeGateway
            };
            if (activeGateway === 'ciabra' && ciabraInstallmentId) {
                resultado.installmentId = ciabraInstallmentId;
            }

            addDebugLog(`[GERARQRCODE] ✅ Resposta enviada ao frontend com sucesso`);
            res.json(resultado);

        } catch (transactionError) {
            await t.rollback();
            console.error('❌ Erro na transação, rollback executado:', transactionError.message);
            throw transactionError;
        }
    } catch (error) {
        let errorMessage = 'Erro ao gerar QR code. Tente novamente.';
        let errorDetails = null;
        let errorCode = null;

        console.error('❌ [GERARQRCODE] Erro capturado:', error.message);

        if (error.response && error.response.data) {
            const apiError = error.response.data;
            errorCode = error.response.status;
            errorDetails = apiError;
            if (apiError.message) errorMessage = apiError.message;
            if (apiError.code) errorCode = apiError.code;
        } else {
            errorMessage = error.message || errorMessage;
            errorDetails = { localError: true, message: error.message };
        }

        res.status(400).json({
            error: errorMessage,
            details: errorDetails,
            httpCode: errorCode,
            debug: { errorType: error.name, hasResponse: !!error.response, responseStatus: error.response?.status }
        });
    }
});

// POST /check-local-status — verifica status local da transação
router.post('/check-local-status', statusCheckLimiter, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID da transação não fornecido.' });

        const purchase = await PurchaseHistory.findOne({ where: { transactionId: id } });
        if (!purchase) {
            console.log(`[STATUS CHECK] ⚠️  Nenhuma compra encontrada para o transactionId: ${id}. Retornando 'Gerado'.`);
            return res.json({ id, status: 'Gerado' });
        }

        console.log(`[STATUS CHECK] 📊 Status para transactionId ${id}: '${purchase.status}'`);
        res.json({ id: purchase.transactionId, status: purchase.status });
    } catch (error) {
        console.error('[STATUS CHECK] ❌ Erro ao verificar status local:', error.message);
        res.status(500).json({ error: 'Erro ao verificar status localmente' });
    }
});

// POST /api/check-ciabra-payment — polling ativo via API CIABRA
const axios = require('axios');
router.post('/api/check-ciabra-payment', statusCheckLimiter, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { transactionId, installmentId } = req.body;
        if (!transactionId) return res.status(400).json({ error: 'Transaction ID não fornecido.' });

        const purchase = await PurchaseHistory.findOne({ where: { transactionId } });
        if (!purchase) {
            return res.json({ status: 'Gerado', source: 'local' });
        }
        if (purchase.status === 'Sucesso') {
            return res.json({ status: 'Sucesso', source: 'local' });
        }
        if (!installmentId) {
            return res.json({ status: purchase.status, source: 'local' });
        }

        console.log(`[CIABRA POLLING] 🔍 Consultando API para installment: ${installmentId}`);

        try {
            const apiUrl = `https://api.az.center/payments/applications/installments/${installmentId}`;
            const authToken = Buffer.from(`${CIABRA_PUBLIC_KEY}:${CIABRA_PRIVATE_KEY}`).toString('base64');

            const response = await axios.get(apiUrl, {
                headers: { 'Content-Type': 'application/json', Authorization: `Basic ${authToken}` },
                timeout: 10000
            });

            const apiData = response.data;
            if (apiData.payment && apiData.payment.status) {
                const paymentStatus = apiData.payment.status.toUpperCase();
                if (paymentStatus === 'CONFIRMED' || paymentStatus === 'PAID' || paymentStatus === 'SUCCESS') {
                    await purchase.update({ status: 'Sucesso' });
                    sendPushNotification('Venda Paga com Sucesso!', `O pagamento de ${purchase.nome} foi confirmado (CIABRA Polling).`);
                    return res.json({ status: 'Sucesso', source: 'ciabra_api', paymentId: apiData.payment.id });
                }
            }

            return res.json({ status: purchase.status, source: 'ciabra_api', paymentStatus: apiData.payment ? apiData.payment.status : null });
        } catch (apiError) {
            console.error(`[CIABRA POLLING] ❌ Erro ao consultar API:`, apiError.message);
            return res.json({ status: purchase.status, source: 'local_fallback', error: apiError.message });
        }
    } catch (error) {
        console.error('[CIABRA POLLING] ❌ Erro crítico:', error.message);
        res.status(500).json({ error: 'Erro ao verificar pagamento' });
    }
});

module.exports = router;
