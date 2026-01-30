const { Sequelize, DataTypes } = require('sequelize');

// Adicione esta linha no topo se ainda não tiver
require('dotenv').config();

// MODIFICADO: A conexão agora usa as variáveis de ambiente
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
  host: process.env.DB_HOST,
  dialect: 'mysql',
  // NOVO: Configurações de segurança e performance
  logging: process.env.NODE_ENV === 'production' ? false : console.log, // Desabilita logs em produção
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  // NOVO: Configuração de timezone
  timezone: '-03:00', // Horário de Brasília (UTC-3)
  define: {
    timestamps: true, // Adiciona createdAt e updatedAt por padrão
    underscored: false, // Usa camelCase ao invés de snake_case
    freezeTableName: true // Evita pluralização automática de nomes de tabelas
  }
});

const Product = require('./product')(sequelize, DataTypes);
const PurchaseHistory = require('./purchaseHistory')(sequelize, DataTypes);
const AdminDevice = require('./adminDevice')(sequelize, DataTypes);
const PaymentSettings = require('./paymentSettings')(sequelize, DataTypes);

// MODIFICADO: Sincroniza os modelos com o banco de forma mais robusta
// ATENÇÃO: Em produção, prefira usar migrations do Sequelize
// AdminDevice é sincronizado separadamente para evitar problema de "too many keys"
async function syncDatabase() {
  try {
    // Sincroniza Product e PurchaseHistory com alter
    const syncOptions = process.env.NODE_ENV === 'production'
      ? { alter: false } // Não altera estrutura em produção
      : { alter: true };  // Permite alterações em desenvolvimento

    await Product.sync(syncOptions);
    await PurchaseHistory.sync(syncOptions);
    await PaymentSettings.sync(syncOptions);

    // Em produção, verifica e adiciona colunas faltantes manualmente
    if (process.env.NODE_ENV === 'production') {
      await addMissingColumns();
    }

    // AdminDevice: tratamento especial para evitar erro de "too many keys"
    try {
      // Tenta sincronizar sem alteração
      await AdminDevice.sync({ alter: false });
    } catch (adminDeviceError) {
      // Se falhar com erro de "too many keys", dropa e recria a tabela
      if (adminDeviceError.parent && adminDeviceError.parent.code === 'ER_TOO_MANY_KEYS') {
        console.log('Detectado problema de "too many keys" na tabela admin_devices. Recriando tabela...');
        await AdminDevice.drop();
        await AdminDevice.sync();
        console.log('Tabela admin_devices recriada com sucesso.');
      } else {
        throw adminDeviceError;
      }
    }

    console.log('Banco sincronizado com sucesso');
  } catch (err) {
    console.error('Erro ao sincronizar o banco:', err);
  }
}

// NOVO: Função para adicionar colunas faltantes em produção
async function addMissingColumns() {
  try {
    // Verifica se a coluna paymentGateway existe na tabela purchase_histories
    const [results] = await sequelize.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${process.env.DB_NAME}'
      AND TABLE_NAME = 'purchase_histories'
      AND COLUMN_NAME = 'paymentGateway'
    `);

    if (results.length === 0) {
      console.log('Adicionando coluna paymentGateway à tabela purchase_histories...');
      await sequelize.query(`
        ALTER TABLE purchase_histories
        ADD COLUMN paymentGateway VARCHAR(50) DEFAULT 'ondapay'
      `);
      console.log('Coluna paymentGateway adicionada com sucesso!');
    }
  } catch (err) {
    console.error('Erro ao verificar/adicionar colunas:', err.message);
  }
}

syncDatabase();

// NOVO: Testa a conexão
sequelize.authenticate()
  .then(() => console.log('Conexão com o banco de dados estabelecida com sucesso.'))
  .catch(err => console.error('Erro ao conectar com o banco de dados:', err));

module.exports = { sequelize, Product, PurchaseHistory, AdminDevice, PaymentSettings };
