'use strict';

const express = require('express');
const { PurchaseHistory } = require('../../models');
const { webhookLimiter } = require('../middlewares/rateLimiters');
const { addDebugLog } = require('../services/ciabraService');
const { sendPushNotification } = require('../services/firebaseService');

// IPs confiáveis da CIABRA (configure via CIABRA_ALLOWED_IPS no .env, separados por vírgula)
// Se CIABRA_ALLOWED_IPS não estiver definido, aceita qualquer IP (fail-open).
// Recomendação: configure CIABRA_ALLOWED_IPS em produção para restringir acesso.
function isTrustedWebhookIp(ip) {
    const allowedIpsEnv = process.env.CIABRA_ALLOWED_IPS;
    if (!allowedIpsEnv) {
        return true; // Aceita qualquer IP quando não configurado
    }
    const allowedIps = allowedIpsEnv.split(',').map(s => s.trim()).filter(Boolean);
    const normalizedIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    return allowedIps.includes(normalizedIp);
}

const router = express.Router();


// POST /ciabra-webhook — recebe webhooks da CIABRA
router.post('/ciabra-webhook', webhookLimiter, async (req, res) => {
    if (!isTrustedWebhookIp(req.ip)) {
        console.warn(`[CIABRA WEBHOOK] ⛔ IP bloqueado: ${req.ip}`);
        return res.status(403).json({ error: 'Acesso negado.' });
    }
    console.log(`[CIABRA WEBHOOK] Webhook recebido — IP: ${req.ip}, hookType: ${req.body?.hookType || 'N/A'}`);

    try {
        const { hookType, invoice, payment, installment } = req.body;

        if (!hookType) {
            console.warn('[CIABRA WEBHOOK] ⚠️ Webhook recebido sem hookType.', req.body);
            return res.status(400).json({ error: 'hookType não informado.' });
        }

        console.log(`[CIABRA WEBHOOK] 📊 Evento: ${hookType}`);

        if (hookType === 'PAYMENT_GENERATED') {
            // O código PIX é capturado diretamente via automação Puppeteer em /gerarqrcode.
            // Apenas confirmamos o recebimento do evento.
            addDebugLog('[WEBHOOK] PAYMENT_GENERATED recebido — acknowledged');
            return res.status(200).json({ status: 'acknowledged' });
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
