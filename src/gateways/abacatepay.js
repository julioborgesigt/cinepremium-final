/**
 * Gateway AbacatePay
 * Implementação específica para o gateway de pagamento AbacatePay
 */

const axios = require('axios');
const BaseGateway = require('./base');
const { getGatewayConfig } = require('../config/gateway');
const { cleanCPF, cleanPhone } = require('../utils/validators');

class AbacatePayGateway extends BaseGateway {
  constructor() {
    const config = getGatewayConfig('abacatepay');
    super('AbacatePay', config);

    this.apiKey = config.credentials.apiKey;
    this.webhookUrl = config.webhookUrl;
    this.maxDescriptionLength = config.maxDescriptionLength || 37;
    this.paidEvents = config.paidEvents;
  }

  /**
   * Verifica se o gateway está configurado
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Headers padrão para requisições
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Cria QR Code PIX via AbacatePay
   */
  async createPixQrCode(payload) {
    if (!this.isConfigured()) {
      this.throwConfigError('API Key não configurada (ABACATEPAY_API_KEY)');
    }

    const { purchaseId, value, nome, cpf, email, telefone, productTitle } = payload;

    // Limita description ao tamanho máximo
    let description = productTitle || 'Pagamento';
    if (description.length > this.maxDescriptionLength) {
      description = description.substring(0, this.maxDescriptionLength - 3) + '...';
    }

    const abacatePayload = {
      amount: value, // AbacatePay espera valor em centavos
      expiresIn: 1800, // 30 minutos em segundos
      description: description,
      customer: {
        name: nome,
        cellphone: cleanPhone(telefone),
        email: email,
        taxId: cleanCPF(cpf)
      },
      metadata: {
        external_id: String(purchaseId),
        product_title: productTitle
      }
    };

    this.logPayment('Creating PIX QR Code', {
      'Purchase ID': purchaseId,
      'Value (cents)': value,
      'Customer': nome
    });

    try {
      const response = await axios.post(
        `${this.apiUrl}/pixQrCode/create`,
        abacatePayload,
        { headers: this.getHeaders() }
      );

      const data = response.data.data || response.data;

      this.logSuccess(`PIX QR Code created: ${data.id}`);

      return {
        transactionId: data.id,
        qrCode: data.brCode,
        qrCodeBase64: data.brCodeBase64,
        gateway: 'abacatepay'
      };

    } catch (error) {
      this.logError('createPixQrCode', error);
      throw error;
    }
  }

  /**
   * Verifica status de um PIX
   */
  async checkPaymentStatus(pixId) {
    if (!this.isConfigured()) {
      this.throwConfigError('API Key não configurada');
    }

    try {
      const response = await axios.get(
        `${this.apiUrl}/pixQrCode/check`,
        {
          params: { id: pixId },
          headers: this.getHeaders()
        }
      );

      return response.data;

    } catch (error) {
      this.logError('checkPaymentStatus', error);
      throw error;
    }
  }

  /**
   * Testa conexão com AbacatePay
   */
  async testConnection() {
    if (!this.isConfigured()) {
      return { success: false, message: 'API Key não configurada' };
    }

    try {
      const response = await axios.get(
        `${this.apiUrl}/store/get`,
        { headers: this.getHeaders() }
      );

      return {
        success: true,
        message: 'Conexão com AbacatePay estabelecida com sucesso',
        data: response.data
      };

    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Processa webhook do AbacatePay
   */
  async processWebhook(body) {
    const { event, data } = body;

    if (!event || !data) {
      return {
        processed: false,
        error: 'Dados do webhook incompletos'
      };
    }

    // Verifica se é evento de pagamento confirmado
    const isPaidEvent = this.paidEvents.includes(event);

    if (!isPaidEvent) {
      return {
        processed: true,
        isPaid: false,
        event,
        message: 'Evento não é de pagamento'
      };
    }

    // Extrai IDs
    let transactionId = null;
    let externalId = null;

    if (data.pixQrCode) {
      transactionId = data.pixQrCode.id;
      if (data.pixQrCode.metadata?.external_id) {
        externalId = data.pixQrCode.metadata.external_id;
      }
    }

    if (data.billing) {
      transactionId = transactionId || data.billing.id;
      if (data.billing.metadata?.external_id) {
        externalId = externalId || data.billing.metadata.external_id;
      }
    }

    return {
      processed: true,
      isPaid: true,
      transactionId,
      externalId,
      event
    };
  }
}

// Singleton
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new AbacatePayGateway();
  }
  return instance;
}

module.exports = {
  AbacatePayGateway,
  getInstance
};
