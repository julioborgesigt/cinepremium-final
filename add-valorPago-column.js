/**
 * Migração: Adicionar coluna valorPago à tabela purchase_histories
 *
 * Execute este script uma vez para adicionar a coluna valorPago ao banco de dados:
 * node add-valorPago-column.js
 */

const { sequelize, PurchaseHistory } = require('./models');

async function migrate() {
  try {
    console.log('🔄 Iniciando migração: adicionando coluna valorPago...');

    // Sincroniza apenas a tabela PurchaseHistory, adicionando novas colunas
    await PurchaseHistory.sync({ alter: true });

    console.log('✅ Migração concluída com sucesso!');
    console.log('📊 Coluna valorPago adicionada à tabela purchase_histories');

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro durante a migração:', error);
    process.exit(1);
  }
}

migrate();
