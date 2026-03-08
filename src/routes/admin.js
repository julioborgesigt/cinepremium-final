'use strict';

const express = require('express');
const path = require('path');
const { Op, fn, col, literal } = require('sequelize');
const { PurchaseHistory, AdminDevice } = require('../../models');
const { requireLogin } = require('../middlewares/auth');
const {
    getActivePaymentGateway,
    setActivePaymentGateway,
    checkCiabraAuth,
    cachedActiveGateway: getCachedActiveGateway,
    CIABRA_PUBLIC_KEY,
    CIABRA_PRIVATE_KEY,
    CIABRA_WEBHOOK_URL
} = require('../services/ciabraService');
const { sendPushNotification } = require('../services/firebaseService');
const { getRedisClient, getSessionStore } = require('../config/redis');

const router = express.Router();

function getApplyCsrf(req) {
    return req.app.get('applyCsrf');
}

// GET /admin — painel administrativo (protegido)
router.get('/admin', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'admin.html'));
});

// GET /api/purchase-history — histórico de compras com filtros e paginação
router.get('/api/purchase-history', requireLogin, async (req, res) => {
    try {
        const { nome, telefone, mes, ano, status, transactionId, dataInicio, dataFim, page = 1, limit = 10 } = req.query;
        let where = {};

        if (nome) {
            const sanitizedNome = nome.replace(/[%_]/g, '\\$&');
            where.nome = { [Op.like]: `%${sanitizedNome}%` };
        }
        if (telefone) where.telefone = telefone;
        if (status) where.status = status;
        if (transactionId) where.transactionId = { [Op.like]: `%${transactionId}%` };

        if (dataInicio && dataFim) {
            const startDate = new Date(dataInicio);
            const endDate = new Date(dataFim);
            endDate.setHours(23, 59, 59, 999);
            where.dataTransacao = { [Op.between]: [startDate, endDate] };
        } else if (mes && ano) {
            const startDate = new Date(ano, mes - 1, 1);
            const endDate = new Date(ano, mes, 0, 23, 59, 59);
            where.dataTransacao = { [Op.between]: [startDate, endDate] };
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const { count, rows: history } = await PurchaseHistory.findAndCountAll({
            where,
            order: [['dataTransacao', 'DESC']],
            limit: parseInt(limit),
            offset
        });

        res.json({
            data: history,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / parseInt(limit))
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao buscar histórico.' });
    }
});

// GET /api/statistics — estatísticas de vendas (usando agregações SQL para performance)
router.get('/api/statistics', requireLogin, async (req, res) => {
    try {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const startOfMonth = new Date(currentYear, currentMonth, 1);
        const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);
        const startOfLastMonth = new Date(currentYear, currentMonth - 1, 1);
        const endOfLastMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        // Todas as agregações em paralelo, com SUM/COUNT direto no banco
        const [currentMonthAgg, lastMonthAgg, allTimeAgg, todaySales, pendingCount] = await Promise.all([
            PurchaseHistory.findOne({
                attributes: [[fn('COUNT', col('id')), 'sales'], [fn('SUM', col('valorPago')), 'revenue']],
                where: { status: 'Sucesso', dataTransacao: { [Op.between]: [startOfMonth, endOfMonth] } },
                raw: true
            }),
            PurchaseHistory.findOne({
                attributes: [[fn('COUNT', col('id')), 'sales'], [fn('SUM', col('valorPago')), 'revenue']],
                where: { status: 'Sucesso', dataTransacao: { [Op.between]: [startOfLastMonth, endOfLastMonth] } },
                raw: true
            }),
            PurchaseHistory.findOne({
                attributes: [[fn('COUNT', col('id')), 'sales'], [fn('SUM', col('valorPago')), 'revenue']],
                where: { status: 'Sucesso' },
                raw: true
            }),
            PurchaseHistory.count({ where: { status: 'Sucesso', dataTransacao: { [Op.between]: [startOfToday, endOfToday] } } }),
            PurchaseHistory.count({ where: { status: 'Gerado' } })
        ]);

        res.json({
            currentMonth: { sales: parseInt(currentMonthAgg.sales) || 0, revenue: parseInt(currentMonthAgg.revenue) || 0 },
            lastMonth: { sales: parseInt(lastMonthAgg.sales) || 0, revenue: parseInt(lastMonthAgg.revenue) || 0 },
            allTime: { sales: parseInt(allTimeAgg.sales) || 0, revenue: parseInt(allTimeAgg.revenue) || 0 },
            today: { sales: todaySales },
            pending: pendingCount
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
    }
});

// POST /api/devices — registra dispositivo para notificações push
router.post('/api/devices', requireLogin, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token não fornecido.' });
    try {
        const [device, created] = await AdminDevice.findOrCreate({ where: { token } });
        if (created) {
            const maskedToken = device.token.substring(0, 8) + '...' + device.token.substring(device.token.length - 4);
            console.log('Novo dispositivo registrado para notificações:', maskedToken);
            res.status(201).json({ message: 'Dispositivo registrado com sucesso.' });
        } else {
            res.status(200).json({ message: 'Dispositivo já estava registrado.' });
        }
    } catch (error) {
        console.error('Erro ao registrar dispositivo:', error);
        res.status(500).json({ error: 'Erro interno ao salvar o token.' });
    }
});

// POST /api/update-transaction-status — atualiza status manualmente
router.post('/api/update-transaction-status', requireLogin, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    const { transactionId, newStatus } = req.body;
    if (!transactionId || !newStatus) {
        return res.status(400).json({ error: 'Transaction ID e novo status são obrigatórios.' });
    }
    try {
        const purchase = await PurchaseHistory.findOne({ where: { transactionId } });
        if (!purchase) return res.status(404).json({ error: 'Transação não encontrada.' });
        const validStatuses = ['Gerado', 'Sucesso', 'Falhou', 'Expirado'];
        if (!validStatuses.includes(newStatus)) {
            return res.status(400).json({ error: `Status inválido. Use: ${validStatuses.join(', ')}` });
        }
        const oldStatus = purchase.status;
        await purchase.update({ status: newStatus });
        console.log(`✅ Status da transação ${transactionId} atualizado de ${oldStatus} para ${newStatus} pelo admin`);
        res.json({ success: true, message: `Status atualizado de "${oldStatus}" para "${newStatus}"`, transactionId, oldStatus, newStatus });
    } catch (error) {
        console.error('Erro ao atualizar status da transação:', error);
        res.status(500).json({ error: 'Erro ao processar atualização de status', details: error.message });
    }
});

// GET /api/payment-settings — configurações de pagamento
router.get('/api/payment-settings', requireLogin, async (req, res) => {
    try {
        const activeGateway = await getActivePaymentGateway();
        res.json({
            activeGateway,
            gateways: { ciabra: { configured: !!(CIABRA_PUBLIC_KEY && CIABRA_PRIVATE_KEY), webhookUrl: CIABRA_WEBHOOK_URL } }
        });
    } catch (error) {
        console.error('Erro ao obter configurações de pagamento:', error);
        res.status(500).json({ error: 'Erro ao obter configurações de pagamento.' });
    }
});

// POST /api/payment-settings/gateway — altera gateway ativo
router.post('/api/payment-settings/gateway', requireLogin, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { gateway } = req.body;
        if (!gateway) return res.status(400).json({ error: 'Gateway não informado.' });
        if (gateway === 'ciabra' && (!CIABRA_PUBLIC_KEY || !CIABRA_PRIVATE_KEY)) {
            return res.status(400).json({ error: 'CIABRA não está configurado. Configure CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY no .env' });
        }
        await setActivePaymentGateway(gateway);
        res.json({ success: true, message: `Gateway alterado para ${gateway} com sucesso.`, activeGateway: gateway });
    } catch (error) {
        console.error('Erro ao alterar gateway:', error);
        res.status(500).json({ error: error.message || 'Erro ao alterar gateway de pagamento.' });
    }
});

// POST /api/payment-settings/test — testa conexão com gateway
router.post('/api/payment-settings/test', requireLogin, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { gateway } = req.body;
        if (!gateway) return res.status(400).json({ error: 'Gateway não informado.' });
        let testResult = { success: false, message: '' };
        if (gateway === 'ciabra') {
            if (!CIABRA_PUBLIC_KEY || !CIABRA_PRIVATE_KEY) {
                testResult = { success: false, message: 'Credenciais CIABRA não configuradas.' };
            } else {
                try {
                    const authResult = await checkCiabraAuth();
                    testResult = authResult.success
                        ? { success: true, message: 'Conexão com CIABRA estabelecida com sucesso!', accountInfo: authResult.data || 'Conta conectada' }
                        : { success: false, message: `Erro ao conectar com CIABRA: ${authResult.error}` };
                } catch (error) {
                    testResult = { success: false, message: `Erro ao conectar com CIABRA: ${error.message}` };
                }
            }
        } else {
            return res.status(400).json({ error: 'Gateway inválido.' });
        }
        res.json(testResult);
    } catch (error) {
        console.error('Erro ao testar gateway:', error);
        res.status(500).json({ error: 'Erro ao testar conexão com gateway.' });
    }
});

// POST /api/simulate-webhook — simula webhook de pagamento confirmado (proteção: requireLogin)
router.post('/api/simulate-webhook', requireLogin, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) { applyCsrf(req, res, next); } else { next(); }
}, async (req, res) => {
    try {
        const { transactionId } = req.body;
        if (!transactionId) return res.status(400).json({ error: 'transactionId é obrigatório' });

        console.log('\n🧪 [SIMULATE WEBHOOK] Simulando recebimento de webhook...');
        const purchase = await PurchaseHistory.findOne({ where: { transactionId } });
        if (!purchase) return res.status(404).json({ error: 'Compra não encontrada' });

        if (purchase.status === 'Sucesso') {
            return res.json({ message: 'Compra já está marcada como Sucesso', alreadyProcessed: true });
        }

        await purchase.update({ status: 'Sucesso' });
        sendPushNotification('Venda Paga com Sucesso!', `O pagamento de ${purchase.nome} foi confirmado (SIMULADO).`);

        res.json({ success: true, message: 'Webhook simulado com sucesso', purchase: { id: purchase.id, transactionId: purchase.transactionId, status: purchase.status, nome: purchase.nome } });
    } catch (error) {
        console.error('[SIMULATE WEBHOOK] ❌ Erro:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/debug-payment/:transactionId — diagnóstico de pagamento
router.get('/api/debug-payment/:transactionId', requireLogin, async (req, res) => {
    try {
        const { transactionId } = req.params;
        const purchase = await PurchaseHistory.findOne({ where: { transactionId } });
        if (!purchase) {
            return res.json({ found: false, message: 'Nenhuma compra encontrada com este transactionId', transactionId });
        }
        res.json({
            found: true,
            purchase: { id: purchase.id, transactionId: purchase.transactionId, nome: purchase.nome, status: purchase.status, dataTransacao: purchase.dataTransacao, createdAt: purchase.createdAt, updatedAt: purchase.updatedAt },
            webhookInfo: { webhookUrl: CIABRA_WEBHOOK_URL || 'NÃO CONFIGURADO', isLocalhost: (CIABRA_WEBHOOK_URL || '').includes('localhost'), warning: (CIABRA_WEBHOOK_URL || '').includes('localhost') ? '⚠️ CIABRA_WEBHOOK_URL aponta para localhost!' : null },
            polling: { endpoint: '/check-local-status', frequency: '5 segundos', timeout: '10 minutos' }
        });
    } catch (error) {
        console.error('[DEBUG] Erro:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/payment-flow-status — análise do fluxo de pagamento
router.get('/api/payment-flow-status', requireLogin, async (req, res) => {
    try {
        const { transactionId, purchaseId } = req.query;
        if (!transactionId && !purchaseId) {
            return res.status(400).json({ error: 'Forneça transactionId ou purchaseId como query parameter' });
        }

        let purchase;
        if (transactionId) {
            purchase = await PurchaseHistory.findOne({ where: { transactionId } });
        } else {
            purchase = await PurchaseHistory.findByPk(purchaseId);
        }

        if (!purchase) {
            return res.json({ found: false, message: 'Compra não encontrada', searchedBy: transactionId ? 'transactionId' : 'purchaseId', searchValue: transactionId || purchaseId });
        }

        res.json({
            purchase: { id: purchase.id, transactionId: purchase.transactionId, nome: purchase.nome, telefone: purchase.telefone, status: purchase.status, valorPago: `R$ ${(purchase.valorPago / 100).toFixed(2)}`, dataTransacao: purchase.dataTransacao },
            flow: {
                step1_qrCodeGenerated: !!purchase.transactionId,
                step2_clientPolling: purchase.status === 'Gerado' ? 'Em andamento' : 'Concluído',
                step3_webhookReceived: purchase.status === 'Sucesso' ? 'Sim' : 'Aguardando',
                step4_statusUpdated: purchase.status === 'Sucesso',
                step5_thankYouPage: purchase.status === 'Sucesso' ? 'Deveria ter sido exibida' : 'Aguardando pagamento'
            },
            webhook: { webhookUrl: CIABRA_WEBHOOK_URL || 'NÃO CONFIGURADO', isLocalhost: (CIABRA_WEBHOOK_URL || '').includes('localhost') }
        });
    } catch (error) {
        console.error('[PAYMENT FLOW STATUS] Erro:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
