'use strict';

const express = require('express');
const crypto = require('crypto');
const { PurchaseHistory } = require('../../models');
const { webhookLimiter } = require('../middlewares/rateLimiters');
const { addDebugLog } = require('../services/ciabraService');
const { sendPushNotification } = require('../services/firebaseService');

// Comparação em tempo constante para não vazar a chave por análise de timing.
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// Valida o header x-ciabra-pub enviado pela CIABRA em cada notificação.
// Docs: cada notificação inclui x-ciabra-pub com a chave pública da aplicação.
// Fail-closed: rejeita se CIABRA_PUBLIC_KEY não estiver configurada.
function isTrustedWebhook(req) {
    if (!process.env.CIABRA_PUBLIC_KEY) {
        console.error('[CIABRA WEBHOOK] CIABRA_PUBLIC_KEY não configurado — rejeitando webhook');
        return false;
    }
    return safeEqual(req.headers['x-ciabra-pub'], process.env.CIABRA_PUBLIC_KEY);
}

const router = express.Router();

// POST /ciabra-webhook — recebe webhooks da CIABRA
router.post('/ciabra-webhook', webhookLimiter, async (req, res) => {
    if (!isTrustedWebhook(req)) {
        console.warn(`[CIABRA WEBHOOK] ⛔ Webhook rejeitado — x-ciabra-pub inválido. IP: ${req.ip}`);
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    console.log(`[CIABRA WEBHOOK] Recebido — IP: ${req.ip}, type: ${req.body?.type || 'N/A'}`);

    try {
        // Payload da CIABRA usa o campo "type" (não "hookType") e estrutura plana.
        const { type, id: invoiceId, externalId, pricePaid } = req.body;

        if (!type) {
            console.warn('[CIABRA WEBHOOK] ⚠️ Webhook sem type.', req.body);
            return res.status(400).json({ error: 'type não informado.' });
        }

        console.log(`[CIABRA WEBHOOK] Evento: ${type}`);

        if (type === 'PAYMENT_GENERATED') {
            // Código PIX já capturado via Puppeteer em /gerarqrcode — confirma recebimento.
            addDebugLog('[WEBHOOK] PAYMENT_GENERATED recebido — acknowledged');
            return res.status(200).json({ status: 'acknowledged' });
        }

        if (type !== 'INVOICE_PAYMENT_CONFIRMED') {
            console.log(`[CIABRA WEBHOOK] Evento '${type}' ignorado.`);
            return res.status(200).json({ status: 'ignored', type });
        }

        // INVOICE_PAYMENT_CONFIRMED — o pagamento foi confirmado pela instituição financeira.
        console.log(`[CIABRA WEBHOOK] Invoice ID: ${invoiceId} | External ID: ${externalId}`);

        if (!invoiceId && !externalId) {
            return res.status(400).json({ error: 'ID da transação não encontrado.' });
        }

        let purchase = null;
        if (invoiceId) {
            purchase = await PurchaseHistory.findOne({ where: { transactionId: invoiceId } });
        }
        if (!purchase && externalId) {
            purchase = await PurchaseHistory.findByPk(parseInt(externalId, 10));
        }
        if (!purchase) {
            console.error(`[CIABRA WEBHOOK] ❌ Compra não encontrada para invoice: ${invoiceId}`);
            return res.status(404).json({ error: 'Compra não encontrada.' });
        }

        if (purchase.status === 'Sucesso') {
            console.log(`[CIABRA WEBHOOK] Webhook duplicado ignorado. Compra ${purchase.id} já processada.`);
            return res.status(200).json({ status: 'already_processed' });
        }

        // pricePaid vem em centavos (ex: 15000 = R$ 150,00), igual ao campo valorPago.
        const updateData = { status: 'Sucesso' };
        if (typeof pricePaid === 'number' && pricePaid > 0) {
            const expected = purchase.valorPago;
            if (typeof expected === 'number' && expected > 0 && pricePaid !== expected) {
                // Valor divergente do esperado: confirma o pagamento, mas preserva o valor
                // original (não deixa um webhook forjado/errado reescrever a receita) e alerta.
                console.warn(`[CIABRA WEBHOOK] ⚠️ Valor divergente na compra ${purchase.id}: esperado ${expected}, recebido ${pricePaid}. Mantendo o valor esperado.`);
            } else {
                updateData.valorPago = pricePaid;
            }
        }
        await purchase.update(updateData);
        console.log(`[CIABRA WEBHOOK] ✅ Compra ${purchase.id} atualizada para 'Sucesso'.`);

        sendPushNotification('Venda Paga com Sucesso!', `O pagamento de ${purchase.nome} foi confirmado (CIABRA).`);

        res.status(200).json({ status: 'ok' });

    } catch (error) {
        console.error('[CIABRA WEBHOOK] ❌ Erro crítico:', error.message);
        res.status(500).json({ error: 'Erro interno ao processar webhook.' });
    }
});

module.exports = router;
