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

// A responsabilidade de gerenciar as estruturas do banco de dados foi movida
// para o Sequelize Migrations (pasta migrations).

// NOVO: Testa a conexão
sequelize.authenticate()
  .then(() => console.log('Conexão com o banco de dados estabelecida com sucesso.'))
  .catch(err => console.error('Erro ao conectar com o banco de dados:', err));

module.exports = { sequelize, Product, PurchaseHistory, AdminDevice, PaymentSettings };
