'use strict';

const express = require('express');
const { PurchaseHistory } = require('../../models');
const { webhookLimiter } = require('../middlewares/rateLimiters');
const { addDebugLog, pixCodesCache, CIABRA_WEBHOOK_URL } = require('../services/ciabraService');
const { sendPushNotification } = require('../services/firebaseService');

const PIX_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

const router = express.Router();

// POST /test-webhook — simula webhook PAYMENT_GENERATED (uso interno de debug)
router.post('/test-webhook', async (req, res) => {
    const { installmentId, emv } = req.body;
    if (!installmentId || !emv) {
        return res.status(400).json({ error: 'installmentId e emv são obrigatórios' });
    }
    addDebugLog(`[TEST] Simulando webhook para installment: ${installmentId}`);
    pixCodesCache.set(installmentId, {
        emv,
        payment: { emv, status: 'WAITING' },
        timestamp: Date.now()
    });
    addDebugLog(`[TEST] Código PIX armazenado! Cache size: ${pixCodesCache.size}`);
    res.json({ status: 'ok', message: 'Webhook simulado com sucesso' });
});

// POST /ciabra-webhook — recebe webhooks da CIABRA
router.post('/ciabra-webhook', webhookLimiter, async (req, res) => {
    console.log('\n=====================================');
    console.log('🔷 [CIABRA WEBHOOK] Webhook Recebido');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('🌐 IP:', req.ip);
    console.log('📦 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📄 Body:', JSON.stringify(req.body, null, 2));
    console.log('=====================================\n');

    try {
        const { hookType, invoice, payment, installment } = req.body;

        if (!hookType) {
            console.warn('[CIABRA WEBHOOK] ⚠️ Webhook recebido sem hookType.', req.body);
            return res.status(400).json({ error: 'hookType não informado.' });
        }

        console.log(`[CIABRA WEBHOOK] 📊 Evento: ${hookType}`);

        if (hookType === 'PAYMENT_GENERATED') {
            addDebugLog('[WEBHOOK] 🔑 PAYMENT_GENERATED recebido!');
            if (payment && installment) {
                const installmentId = installment.id;
                const pixCode = payment.emv;
                addDebugLog(`[WEBHOOK] InstallmentId: ${installmentId}`);
                addDebugLog(`[WEBHOOK] PIX Code: ${pixCode ? 'Presente (' + pixCode.length + ' chars)' : 'Ausente'}`);

                if (pixCode && installmentId) {
                    pixCodesCache.set(installmentId, { emv: pixCode, payment, timestamp: Date.now() });
                    addDebugLog(`[WEBHOOK] ✅ Código PIX armazenado! Cache size: ${pixCodesCache.size}`);
                    setTimeout(() => {
                        if (pixCodesCache.has(installmentId)) {
                            pixCodesCache.delete(installmentId);
                            console.log(`[CIABRA WEBHOOK] 🗑️ Cache expirado para installment ${installmentId}`);
                        }
                    }, PIX_CACHE_TTL);
                } else {
                    addDebugLog('[WEBHOOK] ⚠️ Código PIX ou installmentId ausente');
                }
            } else {
                addDebugLog('[WEBHOOK] ⚠️ payment ou installment ausente no body');
            }
            return res.status(200).json({ status: 'pix_stored' });
        }

        if (hookType !== 'PAYMENT_CONFIRMED') {
            console.log(`[CIABRA WEBHOOK] ℹ️ Evento '${hookType}' não é de confirmação. Ignorando.`);
            return res.status(200).json({ status: 'ignored', hookType });
        }

        let transactionId = null;
        let externalId = null;
        if (invoice) {
            transactionId = invoice.id;
            externalId = invoice.externalId;
        }

        console.log(`[CIABRA WEBHOOK] 📊 Invoice ID: ${transactionId}`);
        console.log(`[CIABRA WEBHOOK] 📊 External ID: ${externalId}`);

        if (!transactionId && !externalId) {
            return res.status(400).json({ error: 'ID da transação não encontrado.' });
        }

        let purchase = null;
        if (transactionId) {
            purchase = await PurchaseHistory.findOne({ where: { transactionId } });
        }
        if (!purchase && externalId) {
            purchase = await PurchaseHistory.findByPk(parseInt(externalId, 10));
        }
        if (!purchase) {
            console.error(`[CIABRA WEBHOOK] ❌ Compra não encontrada para invoice: ${transactionId}`);
            return res.status(404).json({ error: 'Compra não encontrada.' });
        }

        if (purchase.status === 'Sucesso') {
            console.log(`[CIABRA WEBHOOK] ⚠️ Webhook duplicado ignorado. Compra ${purchase.id} já foi processada.`);
            return res.status(200).json({ status: 'already_processed' });
        }

        await purchase.update({ status: 'Sucesso' });
        console.log(`[CIABRA WEBHOOK] ✅ Compra ${purchase.id} atualizada para 'Sucesso'.`);

        sendPushNotification('Venda Paga com Sucesso!', `O pagamento de ${purchase.nome} foi confirmado (CIABRA).`);

        console.log('[CIABRA WEBHOOK] ✅ Webhook processado com sucesso!\n');
        res.status(200).json({ status: 'ok' });

    } catch (error) {
        console.error('[CIABRA WEBHOOK] ❌ Erro crítico:', error.message);
        res.status(500).json({ error: 'Erro interno ao processar webhook.' });
    }
});

module.exports = router;
