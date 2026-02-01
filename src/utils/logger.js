/**
 * Módulo de Logging Centralizado
 * Padroniza logs em toda a aplicação
 */

// Array global para armazenar logs de debug (acessível via endpoint /debug-logs)
const debugLogs = [];
const MAX_DEBUG_LOGS = 1000;

/**
 * Adiciona log ao buffer de debug e console
 * @param {string} message - Mensagem de log
 */
function addDebugLog(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  debugLogs.push(logEntry);
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs.shift();
  }
  console.log(logEntry);
}

/**
 * Retorna os logs de debug
 * @param {number} limit - Número máximo de logs a retornar
 * @returns {Array} Array de logs
 */
function getDebugLogs(limit = 100) {
  return debugLogs.slice(-limit);
}

/**
 * Logger estruturado para webhooks
 * @param {string} gateway - Nome do gateway (ONDAPAY, ABACATEPAY, CIABRA)
 * @param {object} req - Request object
 */
function logWebhookReceived(gateway, req) {
  console.log('\n=====================================');
  console.log(`[${gateway} WEBHOOK] Webhook Recebido`);
  console.log('Timestamp:', new Date().toISOString());
  console.log('IP:', req.ip);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('=====================================\n');
}

/**
 * Logger para processamento de pagamento
 * @param {string} gateway - Nome do gateway
 * @param {string} action - Ação sendo executada
 * @param {object} data - Dados relevantes
 */
function logPayment(gateway, action, data = {}) {
  const prefix = `[${gateway.toUpperCase()}]`;
  const timestamp = new Date().toISOString();

  console.log(`${prefix} [${timestamp}] ${action}`);
  if (Object.keys(data).length > 0) {
    Object.entries(data).forEach(([key, value]) => {
      console.log(`  - ${key}: ${value}`);
    });
  }
}

/**
 * Logger para erros de API
 * @param {string} gateway - Nome do gateway
 * @param {string} operation - Operação que falhou
 * @param {Error} error - Objeto de erro
 */
function logApiError(gateway, operation, error) {
  const prefix = `[${gateway.toUpperCase()}]`;

  console.error(`${prefix} ===== ERRO: ${operation} =====`);
  console.error(`${prefix} Error message:`, error.message);

  if (error.response) {
    console.error(`${prefix} HTTP Status:`, error.response.status);
    console.error(`${prefix} Response data:`, JSON.stringify(error.response.data, null, 2));
    if (process.env.NODE_ENV !== 'production') {
      console.error(`${prefix} Response headers:`, JSON.stringify(error.response.headers, null, 2));
    }
  } else if (error.request) {
    console.error(`${prefix} No response received`);
  } else {
    console.error(`${prefix} Error setting up request:`, error.message);
  }

  if (process.env.NODE_ENV !== 'production' && error.stack) {
    console.error(`${prefix} Stack:`, error.stack);
  }

  console.error(`${prefix} ========================================`);
}

/**
 * Logger para sucesso de operação
 * @param {string} gateway - Nome do gateway
 * @param {string} message - Mensagem de sucesso
 */
function logSuccess(gateway, message) {
  console.log(`[${gateway.toUpperCase()}] ✅ ${message}`);
}

/**
 * Logger para avisos
 * @param {string} gateway - Nome do gateway
 * @param {string} message - Mensagem de aviso
 */
function logWarning(gateway, message) {
  console.warn(`[${gateway.toUpperCase()}] ⚠️ ${message}`);
}

module.exports = {
  addDebugLog,
  getDebugLogs,
  logWebhookReceived,
  logPayment,
  logApiError,
  logSuccess,
  logWarning,
  debugLogs
};
