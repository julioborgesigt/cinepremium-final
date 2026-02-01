/**
 * Gateway Factory / Registry
 * Centraliza acesso aos gateways de pagamento
 */

const { getInstance: getOndaPayInstance } = require('./ondapay');
const { getInstance: getAbacatePayInstance } = require('./abacatepay');
const { getInstance: getCiabraInstance } = require('./ciabra');
const { isValidGateway, checkGatewayCredentials, getAllGatewaysStatus, VALID_GATEWAYS } = require('../config/gateway');

// Cache de gateway ativo
let cachedActiveGateway = null;
let gatewayLastFetch = 0;
const GATEWAY_CACHE_TTL = 60000; // 1 minuto

// Referência ao modelo PaymentSettings (injetada)
let PaymentSettingsModel = null;

/**
 * Injeta o modelo PaymentSettings
 * @param {object} model - Modelo Sequelize PaymentSettings
 */
function setPaymentSettingsModel(model) {
  PaymentSettingsModel = model;
}

/**
 * Obtém instância de um gateway pelo nome
 * @param {string} gatewayName - Nome do gateway
 * @returns {BaseGateway|null}
 */
function getGatewayInstance(gatewayName) {
  const name = gatewayName?.toLowerCase();

  switch (name) {
    case 'ondapay':
      return getOndaPayInstance();
    case 'abacatepay':
      return getAbacatePayInstance();
    case 'ciabra':
      return getCiabraInstance();
    default:
      return null;
  }
}

/**
 * Obtém o gateway de pagamento ativo do banco de dados
 * @returns {Promise<string>}
 */
async function getActiveGateway() {
  const now = Date.now();

  // Usa cache se ainda válido
  if (cachedActiveGateway && (now - gatewayLastFetch) < GATEWAY_CACHE_TTL) {
    return cachedActiveGateway;
  }

  if (!PaymentSettingsModel) {
    console.warn('[GatewayRegistry] PaymentSettingsModel não foi injetado, usando padrão');
    return 'ondapay';
  }

  try {
    let settings = await PaymentSettingsModel.findOne();

    if (!settings) {
      settings = await PaymentSettingsModel.create({ activeGateway: 'ondapay' });
      console.log('✅ Configuração de pagamento criada com gateway padrão: ondapay');
    }

    cachedActiveGateway = settings.activeGateway;
    gatewayLastFetch = now;

    return cachedActiveGateway;

  } catch (error) {
    console.error('❌ Erro ao obter gateway ativo:', error);
    return 'ondapay'; // Fallback
  }
}

/**
 * Define o gateway de pagamento ativo
 * @param {string} gateway - Nome do gateway
 * @returns {Promise<object>}
 */
async function setActiveGateway(gateway) {
  if (!isValidGateway(gateway)) {
    throw new Error(`Gateway inválido: ${gateway}. Use: ${VALID_GATEWAYS.join(', ')}`);
  }

  if (!PaymentSettingsModel) {
    throw new Error('PaymentSettingsModel não foi injetado');
  }

  try {
    let settings = await PaymentSettingsModel.findOne();

    if (!settings) {
      settings = await PaymentSettingsModel.create({ activeGateway: gateway });
    } else {
      await settings.update({ activeGateway: gateway });
    }

    // Invalida cache
    cachedActiveGateway = gateway;
    gatewayLastFetch = Date.now();

    console.log(`✅ Gateway de pagamento alterado para: ${gateway}`);
    return settings;

  } catch (error) {
    console.error('❌ Erro ao alterar gateway:', error);
    throw error;
  }
}

/**
 * Obtém a instância do gateway ativo
 * @returns {Promise<BaseGateway>}
 */
async function getActiveGatewayInstance() {
  const activeGateway = await getActiveGateway();
  return getGatewayInstance(activeGateway);
}

/**
 * Invalida cache do gateway ativo
 */
function invalidateGatewayCache() {
  cachedActiveGateway = null;
  gatewayLastFetch = 0;
}

/**
 * Cria QR Code PIX usando o gateway ativo
 * @param {object} payload - Dados do pagamento
 * @returns {Promise<object>}
 */
async function createPixQrCode(payload) {
  const gateway = await getActiveGatewayInstance();

  if (!gateway) {
    throw new Error('Gateway ativo não configurado');
  }

  if (!gateway.isConfigured()) {
    const gatewayName = await getActiveGateway();
    const check = checkGatewayCredentials(gatewayName);
    throw new Error(`Gateway ${gatewayName} não está configurado. Faltando: ${check.missing.join(', ')}`);
  }

  // Adiciona data de expiração se não tiver
  if (!payload.expirationDate) {
    const { date, formatted } = gateway.getExpirationDate(30);
    payload.expirationDate = formatted;
    payload.expirationTimestamp = date.getTime();
  }

  return gateway.createPixQrCode(payload);
}

/**
 * Testa conexão com um gateway específico
 * @param {string} gatewayName - Nome do gateway
 * @returns {Promise<object>}
 */
async function testGatewayConnection(gatewayName) {
  const gateway = getGatewayInstance(gatewayName);

  if (!gateway) {
    return { success: false, message: `Gateway ${gatewayName} não encontrado` };
  }

  return gateway.testConnection();
}

/**
 * Processa webhook de um gateway específico
 * @param {string} gatewayName - Nome do gateway
 * @param {object} body - Body do webhook
 * @returns {Promise<object>}
 */
async function processWebhook(gatewayName, body) {
  const gateway = getGatewayInstance(gatewayName);

  if (!gateway) {
    return { processed: false, error: `Gateway ${gatewayName} não encontrado` };
  }

  return gateway.processWebhook(body);
}

module.exports = {
  setPaymentSettingsModel,
  getGatewayInstance,
  getActiveGateway,
  setActiveGateway,
  getActiveGatewayInstance,
  invalidateGatewayCache,
  createPixQrCode,
  testGatewayConnection,
  processWebhook,
  isValidGateway,
  checkGatewayCredentials,
  getAllGatewaysStatus,
  VALID_GATEWAYS
};
