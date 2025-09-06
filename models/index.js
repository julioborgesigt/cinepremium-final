const { Sequelize, DataTypes } = require('sequelize');

// Adicione esta linha no topo se ainda não tiver
require('dotenv').config();

// MODIFICADO: A conexão agora usa as variáveis de ambiente
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
  host: process.env.DB_HOST,
  dialect: 'mysql'
});

const Product = require('./product')(sequelize, DataTypes);
const PurchaseHistory = require('./purchaseHistory')(sequelize, DataTypes);

const AdminDevice = require('./adminDevice')(sequelize, DataTypes);

// Sincroniza os modelos com o banco (em produção, prefira migrations)
sequelize.sync({alter: true})
  .then(() => console.log('Banco sincronizado com sucesso'))
  .catch(err => console.error('Erro ao sincronizar o banco:', err));

module.exports = { sequelize, Product, PurchaseHistory, AdminDevice  };
