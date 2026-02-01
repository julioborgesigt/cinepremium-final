/**
 * Módulo Principal - Exporta todos os submódulos
 * Ponto de entrada centralizado para os módulos de pagamento
 */

// Configuração
const gatewayConfig = require('./config/gateway');

// Gateways
const gateways = require('./gateways');
const { OndaPayGateway, getInstance: getOndaPay } = require('./gateways/ondapay');
const { AbacatePayGateway, getInstance: getAbacatePay } = require('./gateways/abacatepay');
const { CiabraGateway, getInstance: getCiabra, pixCodesCache, PIX_CACHE_TTL } = require('./gateways/ciabra');

// Serviços
const purchaseService = require('./services/purchase');
const notificationService = require('./services/notification');

// Webhooks
const webhookHandlers = require('./webhooks/handler');

// Utilidades
const validators = require('./utils/validators');
const logger = require('./utils/logger');
const errors = require('./utils/errors');

/**
 * Inicializa todos os módulos com suas dependências
 * Deve ser chamado após carregar os modelos Sequelize e Firebase
 *
 * @param {object} options - Opções de inicialização
 * @param {object} options.models - Modelos Sequelize { PurchaseHistory, PaymentSettings, AdminDevice }
 * @param {object} options.sequelize - Instância Sequelize
 * @param {object} options.firebaseAdmin - Firebase Admin SDK (opcional)
 * @param {boolean} options.firebaseReady - Se Firebase foi inicializado (opcional)
 */
function initialize(options = {}) {
  const {
    models = {},
    sequelize = null,
    firebaseAdmin = null,
    firebaseReady = false
  } = options;

  // Injeta modelo de configuração de gateway
  if (models.PaymentSettings) {
    gateways.setPaymentSettingsModel(models.PaymentSettings);
  }

  // Injeta modelos de compra
  if (models.PurchaseHistory && sequelize) {
    purchaseService.setModels(models.PurchaseHistory, sequelize);
  }

  // Inicializa serviço de notificações
  if (firebaseAdmin && models.AdminDevice) {
    notificationService.initialize(firebaseAdmin, models.AdminDevice, firebaseReady);
  }

  console.log('✅ Módulos de pagamento inicializados');
}

module.exports = {
  // Inicialização
  initialize,

  // Configuração
  config: gatewayConfig,

  // Gateways
  gateways,
  OndaPayGateway,
  AbacatePayGateway,
  CiabraGateway,
  getOndaPay,
  getAbacatePay,
  getCiabra,
  pixCodesCache,
  PIX_CACHE_TTL,

  // Serviços
  purchaseService,
  notificationService,

  // Webhooks
  webhooks: webhookHandlers,

  // Utilidades
  validators,
  logger,
  errors
};
