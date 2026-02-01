/**
 * Handler Centralizado de Webhooks
 * Processa webhooks de todos os gateways de forma unificada
 */

const { logWebhookReceived } = require('../utils/logger');
const { processWebhook } = require('../gateways');
const purchaseService = require('../services/purchase');
const notificationService = require('../services/notification');

/**
 * Cria middleware de webhook para um gateway específico
 * @param {string} gatewayName - Nome do gateway
 * @returns {function} Express middleware
 */
function createWebhookHandler(gatewayName) {
  return async (req, res) => {
    // Log do webhook recebido
    logWebhookReceived(gatewayName.toUpperCase(), req);

    try {
      // Processa webhook usando o gateway específico
      const result = await processWebhook(gatewayName, req.body);

      if (!result.processed) {
        console.warn(`[${gatewayName.toUpperCase()} WEBHOOK] Dados incompletos:`, result.error);
        return res.status(400).json({ error: result.error });
      }

      // Se não é evento de pagamento, apenas confirma recebimento
      if (!result.isPaid) {
        console.log(`[${gatewayName.toUpperCase()} WEBHOOK] Evento ${result.event || 'desconhecido'} não é de pagamento`);

        // Retorna status específico se for PIX armazenado (CIABRA)
        if (result.pixStored) {
          return res.status(200).json({ status: 'pix_stored' });
        }

        return res.status(200).json({ status: 'ignored', event: result.event });
      }

      // Pagamento confirmado - atualiza compra
      console.log(`[${gatewayName.toUpperCase()} WEBHOOK] Pagamento confirmado: ${result.transactionId}`);

      const updateResult = await purchaseService.markAsPaid(
        result.transactionId,
        result.externalId
      );

      if (!updateResult.success) {
        console.error(`[${gatewayName.toUpperCase()} WEBHOOK] Compra não encontrada: ${result.transactionId}`);
        return res.status(404).json({ error: 'Compra não encontrada' });
      }

      // Idempotência: Se já foi processado
      if (updateResult.alreadyProcessed) {
        console.log(`[${gatewayName.toUpperCase()} WEBHOOK] Webhook duplicado ignorado`);
        return res.status(200).json({ status: 'already_processed' });
      }

      // Envia notificação
      console.log(`[${gatewayName.toUpperCase()} WEBHOOK] Enviando notificação push...`);
      await notificationService.notifyPaymentConfirmed(
        updateResult.purchase.nome,
        gatewayName
      );

      console.log(`[${gatewayName.toUpperCase()} WEBHOOK] Processado com sucesso!`);
      return res.status(200).json({ status: 'ok' });

    } catch (error) {
      console.error(`[${gatewayName.toUpperCase()} WEBHOOK] Erro crítico:`, error.message);
      console.error(`[${gatewayName.toUpperCase()} WEBHOOK] Stack:`, error.stack);
      return res.status(500).json({ error: 'Erro interno ao processar webhook' });
    }
  };
}

/**
 * Handler para webhook OndaPay
 */
const ondapayWebhookHandler = createWebhookHandler('ondapay');

/**
 * Handler para webhook AbacatePay
 */
const abacatepayWebhookHandler = createWebhookHandler('abacatepay');

/**
 * Handler para webhook CIABRA
 */
const ciabraWebhookHandler = createWebhookHandler('ciabra');

module.exports = {
  createWebhookHandler,
  ondapayWebhookHandler,
  abacatepayWebhookHandler,
  ciabraWebhookHandler
};
