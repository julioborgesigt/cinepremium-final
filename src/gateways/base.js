/**
 * Classe Base para Gateways de Pagamento
 * Define a interface que todos os gateways devem implementar
 */

const { GatewayError, ConfigurationError } = require('../utils/errors');
const { logApiError, logSuccess, logPayment } = require('../utils/logger');

/**
 * Classe abstrata base para gateways de pagamento
 * Todos os gateways devem estender esta classe
 */
class BaseGateway {
  constructor(name, config) {
    if (new.target === BaseGateway) {
      throw new Error('BaseGateway é uma classe abstrata e não pode ser instanciada diretamente');
    }

    this.name = name;
    this.config = config;
    this.apiUrl = config.apiUrl;
  }

  /**
   * Verifica se o gateway está configurado
   * @returns {boolean}
   */
  isConfigured() {
    throw new Error('Método isConfigured() deve ser implementado');
  }

  /**
   * Cria um QR Code PIX
   * @param {object} payload - Dados do pagamento
   * @returns {Promise<object>} Resultado com transactionId, qrCode, qrCodeBase64
   */
  async createPixQrCode(payload) {
    throw new Error('Método createPixQrCode() deve ser implementado');
  }

  /**
   * Verifica status de um pagamento
   * @param {string} transactionId - ID da transação
   * @returns {Promise<object>} Status do pagamento
   */
  async checkPaymentStatus(transactionId) {
    throw new Error('Método checkPaymentStatus() deve ser implementado');
  }

  /**
   * Testa conexão com o gateway
   * @returns {Promise<object>} { success: boolean, message: string }
   */
  async testConnection() {
    throw new Error('Método testConnection() deve ser implementado');
  }

  /**
   * Processa webhook recebido
   * @param {object} body - Body do webhook
   * @returns {Promise<object>} { processed: boolean, transactionId, status, ... }
   */
  async processWebhook(body) {
    throw new Error('Método processWebhook() deve ser implementado');
  }

  /**
   * Helper: Loga erro de API
   * @param {string} operation - Operação que falhou
   * @param {Error} error - Erro capturado
   */
  logError(operation, error) {
    logApiError(this.name, operation, error);
  }

  /**
   * Helper: Loga sucesso
   * @param {string} message - Mensagem de sucesso
   */
  logSuccess(message) {
    logSuccess(this.name, message);
  }

  /**
   * Helper: Loga operação de pagamento
   * @param {string} action - Ação sendo executada
   * @param {object} data - Dados relevantes
   */
  logPayment(action, data = {}) {
    logPayment(this.name, action, data);
  }

  /**
   * Helper: Lança erro de configuração
   * @param {string} message - Mensagem de erro
   */
  throwConfigError(message) {
    throw new ConfigurationError(`[${this.name}] ${message}`);
  }

  /**
   * Helper: Lança erro de gateway
   * @param {string} message - Mensagem de erro
   * @param {Error} originalError - Erro original
   */
  throwGatewayError(message, originalError = null) {
    throw new GatewayError(message, this.name, originalError);
  }

  /**
   * Formata data de expiração (30 minutos no futuro)
   * @returns {object} { date: Date, formatted: string }
   */
  getExpirationDate(minutes = 30) {
    const expirationDate = new Date();
    expirationDate.setMinutes(expirationDate.getMinutes() + minutes);

    const pad = (num) => String(num).padStart(2, '0');
    const formatted = `${expirationDate.getFullYear()}-${pad(expirationDate.getMonth() + 1)}-${pad(expirationDate.getDate())} ${pad(expirationDate.getHours())}:${pad(expirationDate.getMinutes())}:${pad(expirationDate.getSeconds())}`;

    return { date: expirationDate, formatted };
  }
}

module.exports = BaseGateway;
