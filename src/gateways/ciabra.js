/**
 * Gateway CIABRA
 * Implementação específica para o gateway de pagamento CIABRA
 */

const axios = require('axios');
const QRCode = require('qrcode');
const BaseGateway = require('./base');
const { getGatewayConfig } = require('../config/gateway');
const { cleanCPF, cleanPhone, centsToReais } = require('../utils/validators');
const { addDebugLog } = require('../utils/logger');

// Cache de códigos PIX (installmentId -> pixData)
const pixCodesCache = new Map();
const PIX_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

class CiabraGateway extends BaseGateway {
  constructor() {
    const config = getGatewayConfig('ciabra');
    super('CIABRA', config);

    this.publicKey = config.credentials.publicKey;
    this.privateKey = config.credentials.privateKey;
    this.webhookUrl = config.webhookUrl;
    this.paymentPageUrl = config.paymentPageUrl;
    this.paidStatuses = config.paidStatuses;
    this.webhookTypes = config.webhookTypes;
  }

  /**
   * Verifica se o gateway está configurado
   */
  isConfigured() {
    return !!(this.publicKey && this.privateKey);
  }

  /**
   * Gera token de autenticação Basic
   */
  getAuthToken() {
    if (!this.isConfigured()) {
      return null;
    }
    return Buffer.from(`${this.publicKey}:${this.privateKey}`).toString('base64');
  }

  /**
   * Headers padrão para requisições
   */
  getHeaders() {
    return {
      'Authorization': `Basic ${this.getAuthToken()}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Cria cliente no CIABRA
   */
  async createCustomer(customerData) {
    if (!this.isConfigured()) {
      this.throwConfigError('Credenciais não configuradas (CIABRA_PUBLIC_KEY, CIABRA_PRIVATE_KEY)');
    }

    this.logPayment('Creating customer', { name: customerData.fullName });

    try {
      const response = await axios.post(
        `${this.apiUrl}/invoices/applications/customers`,
        customerData,
        { headers: this.getHeaders() }
      );

      this.logSuccess(`Customer created: ${response.data.id}`);
      return response.data;

    } catch (error) {
      this.logError('createCustomer', error);

      // Se cliente já existe, pode ser 409 ou 400
      if (error.response?.status === 409 || error.response?.status === 400) {
        this.logPayment('Customer may already exist', error.response.data);
      }

      throw error;
    }
  }

  /**
   * Cria invoice/cobrança no CIABRA
   */
  async createInvoice(invoicePayload) {
    if (!this.isConfigured()) {
      this.throwConfigError('Credenciais não configuradas');
    }

    this.logPayment('Creating invoice', {
      customerId: invoicePayload.customerId,
      price: invoicePayload.price
    });

    try {
      const response = await axios.post(
        `${this.apiUrl}/invoices/applications/invoices`,
        invoicePayload,
        { headers: this.getHeaders() }
      );

      this.logSuccess(`Invoice created: ${response.data.id}`);
      return response.data;

    } catch (error) {
      this.logError('createInvoice', error);
      throw error;
    }
  }

  /**
   * Obtém detalhes de um invoice
   */
  async getInvoiceDetails(invoiceId) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/invoices/applications/invoices/${invoiceId}`,
        { headers: this.getHeaders() }
      );

      return response.data;

    } catch (error) {
      this.logError('getInvoiceDetails', error);
      throw error;
    }
  }

  /**
   * Verifica status de pagamento via API
   */
  async checkPaymentStatus(installmentId) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/payments/applications/installments/${installmentId}`,
        {
          headers: this.getHeaders(),
          timeout: 10000
        }
      );

      const data = response.data;
      let isPaid = false;

      if (data.payment?.status) {
        const status = data.payment.status.toUpperCase();
        isPaid = this.paidStatuses.includes(status);
      }

      return {
        isPaid,
        status: data.payment?.status,
        paymentId: data.payment?.id,
        rawData: data
      };

    } catch (error) {
      this.logError('checkPaymentStatus', error);
      throw error;
    }
  }

  /**
   * Gera QR Code a partir de código PIX
   */
  async generateQrCodeBase64(pixCode) {
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(pixCode, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 1
      });

      // Remove prefixo data:image/png;base64,
      return qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');

    } catch (error) {
      this.logError('generateQrCodeBase64', error);
      return null;
    }
  }

  /**
   * Cria QR Code PIX via CIABRA
   * Fluxo: criar cliente -> criar invoice -> extrair código PIX
   */
  async createPixQrCode(payload) {
    if (!this.isConfigured()) {
      this.throwConfigError('Credenciais não configuradas');
    }

    const {
      purchaseId,
      value,
      nome,
      cpf,
      email,
      telefone,
      productTitle,
      productDescription,
      expirationDate
    } = payload;

    addDebugLog(`[CIABRA] Starting PIX creation for purchase ${purchaseId}`);

    // Converter valor de centavos para reais
    const priceInReais = centsToReais(value);

    // 1. Criar cliente
    const customerData = {
      fullName: nome,
      email: email,
      document: cleanCPF(cpf)
    };

    if (telefone) {
      customerData.phone = cleanPhone(telefone);
    }

    const customer = await this.createCustomer(customerData);
    const customerId = customer.id;

    // 2. Criar invoice
    const description = `${productTitle || 'Produto'} - ${productDescription || ''}`.trim().substring(0, 100);

    const invoicePayload = {
      customerId: customerId,
      description: description,
      dueDate: expirationDate,
      installmentCount: 1,
      invoiceType: 'SINGLE',
      items: [],
      price: priceInReais,
      externalId: String(purchaseId),
      paymentTypes: ['PIX'],
      notifications: [],
      webhooks: [
        { hookType: 'PAYMENT_CONFIRMED', url: this.webhookUrl },
        { hookType: 'PAYMENT_GENERATED', url: this.webhookUrl }
      ]
    };

    const invoice = await this.createInvoice(invoicePayload);
    const transactionId = invoice.id;

    // 3. Extrair installmentId e código PIX
    let installmentId = null;
    let qrCode = null;
    let qrCodeBase64 = null;

    if (invoice.installments?.length > 0) {
      installmentId = invoice.installments[0].id;
      addDebugLog(`[CIABRA] InstallmentId: ${installmentId}`);

      // Tentar extrair código PIX da resposta
      const installment = invoice.installments[0];
      if (installment.payments?.length > 0) {
        const payment = installment.payments[0];
        qrCode = payment.emv || payment.pixCode || payment.code;
        qrCodeBase64 = payment.qrCodeBase64 || payment.base64;
      }
    }

    // 4. Se não tem QR Code ainda, pode precisar aguardar webhook PAYMENT_GENERATED
    // ou usar automação Puppeteer (implementação externa)

    // 5. Se tem código PIX mas não tem imagem, gerar QR Code
    if (qrCode && !qrCodeBase64) {
      addDebugLog('[CIABRA] Generating QR Code from PIX code');
      qrCodeBase64 = await this.generateQrCodeBase64(qrCode);
    }

    this.logSuccess(`PIX created: Invoice ${transactionId}`);

    return {
      transactionId,
      installmentId,
      qrCode,
      qrCodeBase64,
      gateway: 'ciabra'
    };
  }

  /**
   * Testa conexão com CIABRA
   */
  async testConnection() {
    if (!this.isConfigured()) {
      return { success: false, message: 'Credenciais não configuradas' };
    }

    try {
      const response = await axios.get(
        `${this.apiUrl}/auth/applications/check`,
        { headers: this.getHeaders() }
      );

      return {
        success: true,
        message: 'Conexão com CIABRA estabelecida com sucesso',
        data: response.data
      };

    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Processa webhook do CIABRA
   */
  async processWebhook(body) {
    const { hookType, invoice, payment, installment } = body;

    if (!hookType) {
      return {
        processed: false,
        error: 'hookType não informado'
      };
    }

    // Evento PAYMENT_GENERATED - armazena código PIX no cache
    if (hookType === this.webhookTypes.paymentGenerated) {
      if (payment && installment) {
        const installmentId = installment.id;
        const pixCode = payment.emv;

        if (pixCode && installmentId) {
          // Armazenar no cache
          pixCodesCache.set(installmentId, {
            emv: pixCode,
            payment: payment,
            timestamp: Date.now()
          });

          addDebugLog(`[CIABRA] PIX code stored for installment ${installmentId}`);

          // Limpar cache após TTL
          setTimeout(() => {
            if (pixCodesCache.has(installmentId)) {
              pixCodesCache.delete(installmentId);
              addDebugLog(`[CIABRA] Cache expired for installment ${installmentId}`);
            }
          }, PIX_CACHE_TTL);

          return {
            processed: true,
            isPaid: false,
            event: hookType,
            pixStored: true,
            installmentId
          };
        }
      }

      return {
        processed: true,
        isPaid: false,
        event: hookType,
        message: 'PAYMENT_GENERATED without PIX code'
      };
    }

    // Evento PAYMENT_CONFIRMED
    if (hookType === this.webhookTypes.paymentConfirmed) {
      let transactionId = null;
      let externalId = null;

      if (invoice) {
        transactionId = invoice.id;
        externalId = invoice.externalId;
      }

      return {
        processed: true,
        isPaid: true,
        transactionId,
        externalId,
        event: hookType
      };
    }

    // Outros eventos
    return {
      processed: true,
      isPaid: false,
      event: hookType,
      message: 'Evento não processado'
    };
  }

  /**
   * Obtém código PIX do cache
   */
  getPixFromCache(installmentId) {
    return pixCodesCache.get(installmentId);
  }

  /**
   * Retorna tamanho do cache
   */
  getCacheSize() {
    return pixCodesCache.size;
  }

  /**
   * Retorna chaves do cache
   */
  getCacheKeys() {
    return Array.from(pixCodesCache.keys());
  }
}

// Singleton
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new CiabraGateway();
  }
  return instance;
}

module.exports = {
  CiabraGateway,
  getInstance,
  pixCodesCache,
  PIX_CACHE_TTL
};
