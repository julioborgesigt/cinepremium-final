require('dotenv').config();
const { sequelize } = require('./models');

/**
 * Script de migração para consolidar tabelas Product e Products
 *
 * Este script resolve o problema de duplicação de tabelas causado pela
 * mudança de configuração freezeTableName: true
 *
 * Cenários tratados:
 * 1. Só existe Products: renomeia para Product
 * 2. Só existe Product: nada a fazer
 * 3. Ambas existem: mescla dados e remove Products
 */

async function checkTableExists(tableName) {
  const [tables] = await sequelize.query(`SHOW TABLES LIKE '${tableName}'`);
  return tables.length > 0;
}

async function getTableRowCount(tableName) {
  const [result] = await sequelize.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
  return result[0].count;
}

async function migrateProductTable() {
  console.log('🔍 Iniciando verificação das tabelas Product...\n');

  try {
    // Verificar quais tabelas existem
    const productsExists = await checkTableExists('Products');
    const productExists = await checkTableExists('Product');

    console.log(`Tabela 'Products' (plural): ${productsExists ? '✅ Existe' : '❌ Não existe'}`);
    console.log(`Tabela 'Product' (singular): ${productExists ? '✅ Existe' : '❌ Não existe'}\n`);

    // Cenário 1: Nenhuma tabela existe
    if (!productsExists && !productExists) {
      console.log('ℹ️  Nenhuma tabela Product encontrada.');
      console.log('   A tabela será criada automaticamente quando o servidor rodar.\n');
      return;
    }

    // Cenário 2: Só Product existe - tudo certo
    if (productExists && !productsExists) {
      const count = await getTableRowCount('Product');
      console.log('✅ Tudo certo! Apenas a tabela Product (singular) existe.');
      console.log(`   Registros na tabela: ${count}\n`);
      console.log('   Nenhuma migração necessária.\n');
      return;
    }

    // Cenário 3: Só Products existe - precisa renomear
    if (productsExists && !productExists) {
      const count = await getTableRowCount('Products');
      console.log('📦 Encontrada tabela Products (plural) com dados antigos.');
      console.log(`   Registros encontrados: ${count}\n`);
      console.log('🔄 Renomeando tabela Products → Product...');

      await sequelize.query('RENAME TABLE `Products` TO `Product`');

      console.log('✅ Migração concluída com sucesso!');
      console.log(`   Tabela renomeada: Products → Product`);
      console.log(`   ${count} registros preservados\n`);
      return;
    }

    // Cenário 4: Ambas existem - precisa mesclar
    if (productsExists && productExists) {
      const productsCount = await getTableRowCount('Products');
      const productCount = await getTableRowCount('Product');

      console.log('⚠️  ATENÇÃO: Ambas as tabelas existem!\n');
      console.log(`   Products (antiga): ${productsCount} registros`);
      console.log(`   Product (atual):   ${productCount} registros\n`);

      if (productsCount === 0) {
        console.log('🗑️  Tabela Products está vazia. Removendo...');
        await sequelize.query('DROP TABLE `Products`');
        console.log('✅ Tabela Products removida com sucesso!\n');
        return;
      }

      console.log('🔄 Iniciando mesclagem de dados...\n');

      // Verificar estrutura das tabelas
      const [productsColumns] = await sequelize.query('DESCRIBE `Products`');
      const [productColumns] = await sequelize.query('DESCRIBE `Product`');

      console.log('📋 Estrutura das tabelas:');
      console.log(`   Products: ${productsColumns.map(c => c.Field).join(', ')}`);
      console.log(`   Product:  ${productColumns.map(c => c.Field).join(', ')}\n`);

      // Copiar dados que não existem em Product (evitar duplicatas)
      console.log('📥 Copiando dados de Products → Product...');

      const [migrated] = await sequelize.query(`
        INSERT INTO \`Product\` (id, title, price, image, description, orderIndex, createdAt, updatedAt)
        SELECT id, title, price, image, description, orderIndex, createdAt, updatedAt
        FROM \`Products\`
        WHERE id NOT IN (SELECT id FROM \`Product\`)
      `);

      const rowsMigrated = migrated.affectedRows || 0;
      console.log(`✅ ${rowsMigrated} registros copiados (${productCount + rowsMigrated} total)\n`);

      // Remover tabela antiga
      console.log('🗑️  Removendo tabela Products antiga...');
      await sequelize.query('DROP TABLE `Products`');

      console.log('\n✅ Migração concluída com sucesso!');
      console.log(`   Dados mesclados: ${rowsMigrated} novos registros`);
      console.log(`   Total na tabela Product: ${productCount + rowsMigrated}`);
      console.log(`   Tabela Products removida\n`);
    }

  } catch (error) {
    console.error('\n❌ Erro durante a migração:', error.message);
    console.error('\nDetalhes do erro:');
    console.error(error);
    throw error;
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ Conectado ao banco de dados\n');
    console.log('='.repeat(60));
    console.log('  MIGRAÇÃO DE TABELAS PRODUCT');
    console.log('='.repeat(60));
    console.log('\n');

    await migrateProductTable();

    console.log('='.repeat(60));
    console.log('  MIGRAÇÃO FINALIZADA');
    console.log('='.repeat(60));
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Falha na migração');
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('🔌 Conexão com banco de dados fechada\n');
  }
}

// Executar migração
main();
