/**
 * Gateway OndaPay
 * Implementação específica para o gateway de pagamento OndaPay
 */

const axios = require('axios');
const BaseGateway = require('./base');
const { getGatewayConfig } = require('../config/gateway');
const { centsToReais, cleanCPF } = require('../utils/validators');

class OndaPayGateway extends BaseGateway {
  constructor() {
    const config = getGatewayConfig('ondapay');
    super('OndaPay', config);

    this.clientId = config.credentials.clientId;
    this.clientSecret = config.credentials.clientSecret;
    this.webhookUrl = config.webhookUrl;

    // Cache de token
    this.token = null;
    this.tokenPromise = null;
  }

  /**
   * Verifica se o gateway está configurado
   */
  isConfigured() {
    return !!(this.clientId && this.clientSecret);
  }

  /**
   * Obtém ou renova token de autenticação
   * Implementa cache com lock para evitar race conditions
   */
  async getToken(forceNew = false) {
    if (this.token && !forceNew) {
      return this.token;
    }

    // Se já existe uma requisição em andamento, retorna a mesma promise
    if (this.tokenPromise && !forceNew) {
      this.logPayment('Token request already in progress, waiting...');
      return this.tokenPromise;
    }

    this.tokenPromise = (async () => {
      try {
        this.logPayment('Requesting new token...');

        const response = await axios.post(
          `${this.apiUrl}/api/v1/login`,
          {},
          {
            headers: {
              'client_id': this.clientId,
              'client_secret': this.clientSecret,
              'Content-Type': 'application/json'
            }
          }
        );

        this.token = response.data.token;
        this.logSuccess('Token obtained successfully');
        return this.token;

      } catch (error) {
        this.logError('getToken', error);
        this.token = null;
        throw new Error('Não foi possível autenticar com o OndaPay');
      } finally {
        this.tokenPromise = null;
      }
    })();

    return this.tokenPromise;
  }

  /**
   * Cria QR Code PIX via OndaPay
   */
  async createPixQrCode(payload) {
    if (!this.isConfigured()) {
      this.throwConfigError('Credenciais não configuradas (ONDAPAY_CLIENT_ID, ONDAPAY_CLIENT_SECRET)');
    }

    const { purchaseId, value, nome, cpf, email, productTitle, productDescription, expirationDate } = payload;

    // Monta payload para OndaPay
    const ondaPayload = {
      amount: centsToReais(value),
      external_id: String(purchaseId),
      webhook: this.webhookUrl,
      description: `${productTitle || 'Produto'} - ${productDescription || ''}`.trim(),
      dueDate: expirationDate,
      payer: {
        name: nome,
        document: cleanCPF(cpf),
        email: email
      }
    };

    this.logPayment('Creating PIX QR Code', {
      'Purchase ID': purchaseId,
      'Value (R$)': centsToReais(value),
      'Customer': nome
    });

    let token = await this.getToken();
    let response;

    try {
      response = await axios.post(
        `${this.apiUrl}/api/v1/deposit/pix`,
        ondaPayload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      // Se token expirou, tenta renovar
      if (error.response?.status === 401) {
        this.logPayment('Token expired, renewing...');
        token = await this.getToken(true);

        response = await axios.post(
          `${this.apiUrl}/api/v1/deposit/pix`,
          ondaPayload,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } else {
        this.logError('createPixQrCode', error);
        throw error;
      }
    }

    const data = response.data;

    this.logSuccess(`PIX QR Code created: ${data.id_transaction}`);

    return {
      transactionId: data.id_transaction,
      qrCode: data.qrcode,
      qrCodeBase64: data.qrcode_base64,
      gateway: 'ondapay'
    };
  }

  /**
   * Testa conexão com OndaPay
   */
  async testConnection() {
    try {
      await this.getToken(true);
      return { success: true, message: 'Conexão com OndaPay estabelecida com sucesso' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Processa webhook do OndaPay
   */
  async processWebhook(body) {
    const { status, transaction_id, external_id } = body;

    if (!status || !transaction_id || !external_id) {
      return {
        processed: false,
        error: 'Dados do webhook incompletos'
      };
    }

    const isPaid = status.toUpperCase() === 'PAID_OUT';

    return {
      processed: true,
      isPaid,
      transactionId: transaction_id,
      externalId: external_id,
      status: status
    };
  }
}

// Singleton
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new OndaPayGateway();
  }
  return instance;
}

module.exports = {
  OndaPayGateway,
  getInstance
};
