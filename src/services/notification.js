/**
 * Serviço de Notificações Push
 * Centraliza envio de notificações via Firebase
 */

let firebaseAdmin = null;
let AdminDeviceModel = null;
let isInitialized = false;

/**
 * Inicializa o serviço de notificações
 * @param {object} admin - Firebase Admin SDK
 * @param {object} AdminDevice - Modelo AdminDevice
 * @param {boolean} firebaseReady - Se Firebase foi inicializado com sucesso
 */
function initialize(admin, AdminDevice, firebaseReady = true) {
  firebaseAdmin = admin;
  AdminDeviceModel = AdminDevice;
  isInitialized = firebaseReady;
}

/**
 * Verifica se o serviço está pronto
 * @returns {boolean}
 */
function isReady() {
  return isInitialized && firebaseAdmin && AdminDeviceModel;
}

/**
 * Envia notificação push para todos os dispositivos admin
 * @param {string} title - Título da notificação
 * @param {string} body - Corpo da notificação
 * @returns {Promise<object>}
 */
async function sendPushNotification(title, body) {
  if (!isReady()) {
    console.warn('[PUSH] Firebase não está disponível. Notificação não será enviada.');
    return { success: false, reason: 'not_initialized' };
  }

  console.log(`[PUSH] Iniciando envio: "${title}"`);

  try {
    const devices = await AdminDeviceModel.findAll({
      attributes: ['token'],
      raw: true
    });

    const tokens = devices.map(device => device.token);

    if (tokens.length === 0) {
      console.log('[PUSH] Nenhum dispositivo encontrado. Abortando.');
      return { success: false, reason: 'no_devices' };
    }

    console.log(`[PUSH] Encontrados ${tokens.length} dispositivo(s)`);

    const message = {
      notification: { title, body },
      tokens: tokens
    };

    const response = await firebaseAdmin.messaging().sendEachForMulticast(message);

    console.log(`[PUSH] Sucesso: ${response.successCount}, Falha: ${response.failureCount}`);

    // Limpa tokens inválidos
    if (response.failureCount > 0) {
      await cleanupInvalidTokens(tokens, response.responses);
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount
    };

  } catch (error) {
    console.error('[PUSH] Erro ao enviar notificação:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove tokens inválidos do banco de dados
 * @param {string[]} tokens - Lista original de tokens
 * @param {object[]} responses - Respostas do Firebase
 */
async function cleanupInvalidTokens(tokens, responses) {
  const tokensToRemove = [];

  responses.forEach((resp, index) => {
    if (!resp.success) {
      console.error('[PUSH] Falha no token:', resp.error);

      const invalidCodes = [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token'
      ];

      if (invalidCodes.includes(resp.error?.code)) {
        tokensToRemove.push(tokens[index]);
      }
    }
  });

  if (tokensToRemove.length > 0) {
    try {
      const deleted = await AdminDeviceModel.destroy({
        where: { token: tokensToRemove }
      });
      console.log(`[PUSH] Removidos ${deleted} token(s) inválido(s)`);
    } catch (error) {
      console.error('[PUSH] Erro ao remover tokens:', error);
    }
  }
}

/**
 * Envia notificação de nova venda gerada
 * @param {string} customerName - Nome do cliente
 */
async function notifyNewSale(customerName) {
  return sendPushNotification(
    'Nova Tentativa de Venda!',
    `${customerName} gerou um QR Code para pagamento.`
  );
}

/**
 * Envia notificação de pagamento confirmado
 * @param {string} customerName - Nome do cliente
 * @param {string} gateway - Gateway utilizado
 */
async function notifyPaymentConfirmed(customerName, gateway = '') {
  const gatewayInfo = gateway ? ` (${gateway})` : '';
  return sendPushNotification(
    'Venda Paga com Sucesso!',
    `O pagamento de ${customerName} foi confirmado${gatewayInfo}.`
  );
}

module.exports = {
  initialize,
  isReady,
  sendPushNotification,
  notifyNewSale,
  notifyPaymentConfirmed
};
