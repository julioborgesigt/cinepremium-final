/**
 * Configuração Centralizada de Gateways de Pagamento
 * Define URLs, credenciais e configurações para cada gateway
 */

// Configurações dos gateways
const GATEWAY_CONFIG = {
  ondapay: {
    name: 'OndaPay',
    apiUrl: 'https://api.ondapay.app',
    endpoints: {
      login: '/api/v1/login',
      createPix: '/api/v1/deposit/pix'
    },
    credentials: {
      clientId: process.env.ONDAPAY_CLIENT_ID,
      clientSecret: process.env.ONDAPAY_CLIENT_SECRET
    },
    webhookUrl: process.env.WEBHOOK_URL || 'https://cinepremiumedit.domcloud.dev/ondapay-webhook',
    // Webhook events
    paidStatus: 'PAID_OUT'
  },

  abacatepay: {
    name: 'AbacatePay',
    apiUrl: 'https://api.abacatepay.com/v1',
    endpoints: {
      createPix: '/pixQrCode/create',
      checkStatus: '/pixQrCode/check',
      storeInfo: '/store/get'
    },
    credentials: {
      apiKey: process.env.ABACATEPAY_API_KEY
    },
    webhookUrl: process.env.ABACATEPAY_WEBHOOK_URL || 'https://cinepremiumedit.domcloud.dev/abacatepay-webhook',
    // Webhook events
    paidEvents: ['BILLING.PAID', 'PIX_QR_CODE.PAID', 'billing.paid', 'pixQrCode.paid'],
    maxDescriptionLength: 37
  },

  ciabra: {
    name: 'CIABRA',
    apiUrl: 'https://api.az.center',
    paymentPageUrl: 'https://pagar.ciabra.com.br',
    endpoints: {
      createCustomer: '/invoices/applications/customers',
      createInvoice: '/invoices/applications/invoices',
      getInvoice: '/invoices/applications/invoices',
      checkAuth: '/auth/applications/check',
      checkPayment: '/payments/applications/installments'
    },
    credentials: {
      publicKey: process.env.CIABRA_PUBLIC_KEY,
      privateKey: process.env.CIABRA_PRIVATE_KEY
    },
    webhookUrl: process.env.CIABRA_WEBHOOK_URL || 'https://cinepremiumedit.domcloud.dev/ciabra-webhook',
    // Webhook events
    webhookTypes: {
      paymentGenerated: 'PAYMENT_GENERATED',
      paymentConfirmed: 'PAYMENT_CONFIRMED'
    },
    paidStatuses: ['CONFIRMED', 'PAID', 'SUCCESS']
  }
};

// Lista de gateways válidos
const VALID_GATEWAYS = ['ondapay', 'abacatepay', 'ciabra'];

/**
 * Obtém configuração de um gateway
 * @param {string} gateway - Nome do gateway
 * @returns {object|null} Configuração do gateway
 */
function getGatewayConfig(gateway) {
  const key = gateway?.toLowerCase();
  return GATEWAY_CONFIG[key] || null;
}

/**
 * Verifica se o gateway é válido
 * @param {string} gateway - Nome do gateway
 * @returns {boolean}
 */
function isValidGateway(gateway) {
  return VALID_GATEWAYS.includes(gateway?.toLowerCase());
}

/**
 * Verifica se o gateway está configurado (tem credenciais)
 * @param {string} gateway - Nome do gateway
 * @returns {object} { configured: boolean, missing: string[] }
 */
function checkGatewayCredentials(gateway) {
  const config = getGatewayConfig(gateway);
  if (!config) {
    return { configured: false, missing: ['gateway inválido'] };
  }

  const missing = [];

  switch (gateway.toLowerCase()) {
    case 'ondapay':
      if (!config.credentials.clientId) missing.push('ONDAPAY_CLIENT_ID');
      if (!config.credentials.clientSecret) missing.push('ONDAPAY_CLIENT_SECRET');
      break;

    case 'abacatepay':
      if (!config.credentials.apiKey) missing.push('ABACATEPAY_API_KEY');
      break;

    case 'ciabra':
      if (!config.credentials.publicKey) missing.push('CIABRA_PUBLIC_KEY');
      if (!config.credentials.privateKey) missing.push('CIABRA_PRIVATE_KEY');
      break;
  }

  return {
    configured: missing.length === 0,
    missing
  };
}

/**
 * Retorna status de configuração de todos os gateways
 * @returns {object} Status de cada gateway
 */
function getAllGatewaysStatus() {
  const status = {};

  for (const gateway of VALID_GATEWAYS) {
    const check = checkGatewayCredentials(gateway);
    status[gateway] = {
      name: GATEWAY_CONFIG[gateway].name,
      configured: check.configured,
      missing: check.missing
    };
  }

  return status;
}

module.exports = {
  GATEWAY_CONFIG,
  VALID_GATEWAYS,
  getGatewayConfig,
  isValidGateway,
  checkGatewayCredentials,
  getAllGatewaysStatus
};
