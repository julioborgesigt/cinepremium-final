/**
 * Serviço de Compras/Transações
 * Centraliza lógica de negócio relacionada a compras
 */

const { Op } = require('sequelize');

// Referências aos modelos (injetados)
let PurchaseHistoryModel = null;
let sequelizeInstance = null;

/**
 * Injeta os modelos necessários
 * @param {object} PurchaseHistory - Modelo PurchaseHistory
 * @param {object} sequelize - Instância Sequelize
 */
function setModels(PurchaseHistory, sequelize) {
  PurchaseHistoryModel = PurchaseHistory;
  sequelizeInstance = sequelize;
}

/**
 * Verifica rate limit de compras por telefone
 * @param {string} telefone - Telefone do cliente
 * @returns {Promise<object>} { allowed: boolean, message: string }
 */
async function checkRateLimit(telefone) {
  if (!PurchaseHistoryModel) {
    throw new Error('PurchaseHistoryModel não foi injetado');
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const attemptsLastHour = await PurchaseHistoryModel.count({
    where: {
      telefone,
      dataTransacao: { [Op.gte]: oneHourAgo }
    }
  });

  const attemptsLastMonth = await PurchaseHistoryModel.count({
    where: {
      telefone,
      dataTransacao: { [Op.gte]: oneMonthAgo }
    }
  });

  if (attemptsLastHour >= 3) {
    return {
      allowed: false,
      message: 'Você já tentou pagar muitas vezes na última hora. Tente novamente mais tarde.'
    };
  }

  if (attemptsLastMonth >= 5) {
    return {
      allowed: false,
      message: 'Você já tentou pagar muitas vezes este mês. Procure seu vendedor.'
    };
  }

  return { allowed: true };
}

/**
 * Cria um novo registro de compra
 * @param {object} data - Dados da compra
 * @param {object} transaction - Transação Sequelize (opcional)
 * @returns {Promise<object>}
 */
async function createPurchase(data, transaction = null) {
  if (!PurchaseHistoryModel) {
    throw new Error('PurchaseHistoryModel não foi injetado');
  }

  const purchaseData = {
    nome: data.nome,
    telefone: data.telefone,
    status: data.status || 'Gerado',
    valorPago: data.valorPago || data.value
  };

  const options = transaction ? { transaction } : {};

  return PurchaseHistoryModel.create(purchaseData, options);
}

/**
 * Atualiza uma compra com transactionId e gateway
 * @param {number} purchaseId - ID da compra
 * @param {string} transactionId - ID da transação no gateway
 * @param {string} gateway - Nome do gateway
 * @param {object} transaction - Transação Sequelize (opcional)
 * @returns {Promise<object>}
 */
async function updatePurchaseTransaction(purchaseId, transactionId, gateway, transaction = null) {
  if (!PurchaseHistoryModel) {
    throw new Error('PurchaseHistoryModel não foi injetado');
  }

  const purchase = await PurchaseHistoryModel.findByPk(purchaseId);

  if (!purchase) {
    throw new Error(`Compra ${purchaseId} não encontrada`);
  }

  const options = transaction ? { transaction } : {};

  await purchase.update({
    transactionId,
    paymentGateway: gateway
  }, options);

  return purchase;
}

/**
 * Busca compra por transactionId
 * @param {string} transactionId - ID da transação
 * @returns {Promise<object|null>}
 */
async function findByTransactionId(transactionId) {
  if (!PurchaseHistoryModel) {
    throw new Error('PurchaseHistoryModel não foi injetado');
  }

  return PurchaseHistoryModel.findOne({
    where: { transactionId }
  });
}

/**
 * Busca compra por ID
 * @param {number} id - ID da compra
 * @returns {Promise<object|null>}
 */
async function findById(id) {
  if (!PurchaseHistoryModel) {
    throw new Error('PurchaseHistoryModel não foi injetado');
  }

  return PurchaseHistoryModel.findByPk(id);
}

/**
 * Atualiza status de uma compra para 'Sucesso'
 * Verifica idempotência (não processa se já está pago)
 * @param {string} transactionId - ID da transação
 * @param {string|number} externalId - ID externo (purchase ID)
 * @returns {Promise<object>} { success, alreadyProcessed, purchase }
 */
async function markAsPaid(transactionId, externalId = null) {
  if (!PurchaseHistoryModel) {
    throw new Error('PurchaseHistoryModel não foi injetado');
  }

  let purchase = null;

  // Busca por transactionId
  if (transactionId) {
    purchase = await PurchaseHistoryModel.findOne({
      where: { transactionId }
    });
  }

  // Se não encontrou e tem externalId, busca por ID
  if (!purchase && externalId) {
    const purchaseId = parseInt(externalId, 10);
    if (!isNaN(purchaseId)) {
      purchase = await PurchaseHistoryModel.findByPk(purchaseId);
    }
  }

  if (!purchase) {
    return {
      success: false,
      error: 'Compra não encontrada',
      purchase: null
    };
  }

  // Idempotência: Se já foi processado, retorna sem fazer nada
  if (purchase.status === 'Sucesso') {
    return {
      success: true,
      alreadyProcessed: true,
      purchase
    };
  }

  // Atualiza status
  await purchase.update({ status: 'Sucesso' });

  return {
    success: true,
    alreadyProcessed: false,
    purchase
  };
}

/**
 * Obtém status de uma compra
 * @param {string} transactionId - ID da transação
 * @returns {Promise<object>} { found, status, purchase }
 */
async function getStatus(transactionId) {
  if (!PurchaseHistoryModel) {
    throw new Error('PurchaseHistoryModel não foi injetado');
  }

  const purchase = await PurchaseHistoryModel.findOne({
    where: { transactionId }
  });

  if (!purchase) {
    return {
      found: false,
      status: 'Gerado' // Status padrão se não encontrar
    };
  }

  return {
    found: true,
    status: purchase.status,
    purchase
  };
}

/**
 * Inicia uma transação de banco de dados
 * @returns {Promise<object>}
 */
async function startTransaction() {
  if (!sequelizeInstance) {
    throw new Error('sequelizeInstance não foi injetado');
  }

  return sequelizeInstance.transaction();
}

/**
 * Lista compras recentes com paginação
 * @param {object} options - Opções de busca
 * @returns {Promise<object>}
 */
async function listPurchases(options = {}) {
  if (!PurchaseHistoryModel) {
    throw new Error('PurchaseHistoryModel não foi injetado');
  }

  const {
    page = 1,
    limit = 20,
    status = null,
    telefone = null,
    gateway = null,
    startDate = null,
    endDate = null
  } = options;

  const where = {};

  if (status) {
    where.status = status;
  }

  if (telefone) {
    where.telefone = telefone;
  }

  if (gateway) {
    where.paymentGateway = gateway;
  }

  if (startDate || endDate) {
    where.dataTransacao = {};
    if (startDate) where.dataTransacao[Op.gte] = new Date(startDate);
    if (endDate) where.dataTransacao[Op.lte] = new Date(endDate);
  }

  const offset = (page - 1) * limit;

  const { count, rows } = await PurchaseHistoryModel.findAndCountAll({
    where,
    order: [['dataTransacao', 'DESC']],
    limit,
    offset
  });

  return {
    purchases: rows,
    total: count,
    page,
    totalPages: Math.ceil(count / limit)
  };
}

module.exports = {
  setModels,
  checkRateLimit,
  createPurchase,
  updatePurchaseTransaction,
  findByTransactionId,
  findById,
  markAsPaid,
  getStatus,
  startTransaction,
  listPurchases
};
