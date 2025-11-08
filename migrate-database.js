/**
 * Script de Migração - CinePremium
 *
 * Este script aplica as seguintes alterações no banco de dados:
 * 1. Adiciona índices para melhorar performance
 * 2. Converte campo status de STRING para ENUM
 * 3. Adiciona constraint UNIQUE ao transactionId
 *
 * IMPORTANTE: Execute este script APENAS UMA VEZ após o deploy
 *
 * Uso:
 * node migrate-database.js
 */

require('dotenv').config();
const { sequelize } = require('./models');

// Cores para terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, total, message) {
  log(`[${step}/${total}] ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

async function checkIndexExists(tableName, indexName) {
  try {
    // CORREÇÃO: Usar replacements ao invés de interpolação direta
    const [results] = await sequelize.query(`
      SELECT COUNT(*) as count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = :tableName
        AND index_name = :indexName
    `, {
      replacements: { tableName, indexName }
    });
    return results[0].count > 0;
  } catch (error) {
    logWarning(`Erro ao verificar índice ${indexName}: ${error.message}`);
    return false;
  }
}

async function createIndex(tableName, indexName, fields, unique = false) {
  try {
    const exists = await checkIndexExists(tableName, indexName);

    if (exists) {
      logInfo(`Índice '${indexName}' já existe - pulando`);
      return false;
    }

    const uniqueStr = unique ? 'UNIQUE' : '';
    const fieldsStr = Array.isArray(fields) ? fields.join(', ') : fields;

    await sequelize.query(`
      CREATE ${uniqueStr} INDEX ${indexName}
      ON ${tableName} (${fieldsStr})
    `);

    logSuccess(`Índice '${indexName}' criado`);
    return true;
  } catch (error) {
    logError(`Falha ao criar índice '${indexName}': ${error.message}`);
    throw error;
  }
}

async function checkColumnType(tableName, columnName) {
  try {
    // CORREÇÃO: Usar replacements ao invés de interpolação direta
    const [results] = await sequelize.query(`
      SELECT COLUMN_TYPE
      FROM information_schema.COLUMNS
      WHERE table_schema = DATABASE()
        AND table_name = :tableName
        AND column_name = :columnName
    `, {
      replacements: { tableName, columnName }
    });
    return results[0]?.COLUMN_TYPE || null;
  } catch (error) {
    logWarning(`Erro ao verificar coluna ${columnName}: ${error.message}`);
    return null;
  }
}

async function migrateStatusToEnum() {
  try {
    const currentType = await checkColumnType('purchase_histories', 'status');

    if (!currentType) {
      logError('Não foi possível verificar o tipo da coluna status');
      return false;
    }

    // Se já é ENUM com os valores corretos
    if (currentType.includes('enum') &&
        currentType.includes('Gerado') &&
        currentType.includes('Sucesso') &&
        currentType.includes('Falhou') &&
        currentType.includes('Expirado')) {
      logInfo("Coluna 'status' já é ENUM com valores corretos - pulando");
      return false;
    }

    logInfo(`Tipo atual da coluna status: ${currentType}`);
    logInfo('Convertendo coluna status para ENUM...');

    // Passo 1: Verificar se existem valores inválidos
    const [invalidValues] = await sequelize.query(`
      SELECT DISTINCT status
      FROM purchase_histories
      WHERE status NOT IN ('Gerado', 'Sucesso', 'Falhou', 'Expirado')
    `);

    if (invalidValues.length > 0) {
      logWarning('Valores inválidos encontrados:');
      invalidValues.forEach(row => {
        logWarning(`  - "${row.status}"`);
      });

      // Atualiza valores inválidos para 'Gerado'
      await sequelize.query(`
        UPDATE purchase_histories
        SET status = 'Gerado'
        WHERE status NOT IN ('Gerado', 'Sucesso', 'Falhou', 'Expirado')
      `);
      logSuccess('Valores inválidos corrigidos para "Gerado"');
    }

    // Passo 2: Alterar coluna para ENUM
    await sequelize.query(`
      ALTER TABLE purchase_histories
      MODIFY COLUMN status ENUM('Gerado', 'Sucesso', 'Falhou', 'Expirado')
      NOT NULL DEFAULT 'Gerado'
    `);

    logSuccess('Coluna status convertida para ENUM');
    return true;
  } catch (error) {
    logError(`Falha ao converter status para ENUM: ${error.message}`);
    throw error;
  }
}

async function addUniqueConstraintToTransactionId() {
  try {
    // Verifica se já existe constraint unique
    const indexExists = await checkIndexExists('purchase_histories', 'idx_transactionId');

    if (indexExists) {
      // Verifica se é UNIQUE
      const [results] = await sequelize.query(`
        SELECT NON_UNIQUE
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'purchase_histories'
          AND index_name = 'idx_transactionId'
        LIMIT 1
      `);

      if (results[0]?.NON_UNIQUE === 0) {
        logInfo("Constraint UNIQUE em transactionId já existe - pulando");
        return false;
      }
    }

    // Passo 1: Encontrar e corrigir duplicatas
    const [duplicates] = await sequelize.query(`
      SELECT transactionId, COUNT(*) as count
      FROM purchase_histories
      WHERE transactionId IS NOT NULL
      GROUP BY transactionId
      HAVING count > 1
    `);

    if (duplicates.length > 0) {
      logWarning(`${duplicates.length} transactionId(s) duplicado(s) encontrado(s)`);

      for (const dup of duplicates) {
        logWarning(`  - transactionId: ${dup.transactionId} (${dup.count} ocorrências)`);

        // Mantém apenas o primeiro registro, limpa os outros
        await sequelize.query(`
          UPDATE purchase_histories
          SET transactionId = NULL
          WHERE transactionId = :txId
          AND id NOT IN (
            SELECT * FROM (
              SELECT MIN(id)
              FROM purchase_histories
              WHERE transactionId = :txId
            ) as subquery
          )
        `, {
          replacements: { txId: dup.transactionId }
        });
      }
      logSuccess('Duplicatas corrigidas');
    }

    // Passo 2: Remove índice antigo se existir
    if (indexExists) {
      await sequelize.query(`DROP INDEX idx_transactionId ON purchase_histories`);
      logInfo('Índice antigo removido');
    }

    // Passo 3: Cria índice UNIQUE
    await sequelize.query(`
      CREATE UNIQUE INDEX idx_transactionId
      ON purchase_histories (transactionId)
    `);

    logSuccess('Constraint UNIQUE adicionada ao transactionId');
    return true;
  } catch (error) {
    logError(`Falha ao adicionar constraint UNIQUE: ${error.message}`);
    throw error;
  }
}

async function runMigration() {
  log('\n' + '='.repeat(60), 'bright');
  log('MIGRAÇÃO DE BANCO DE DADOS - CINEPREMIUM', 'bright');
  log('='.repeat(60) + '\n', 'bright');

  const startTime = Date.now();
  let changesCount = 0;

  try {
    // Testa conexão
    logStep(1, 7, 'Testando conexão com o banco de dados...');
    await sequelize.authenticate();
    logSuccess('Conexão estabelecida');

    // Migra status para ENUM
    logStep(2, 7, 'Convertendo coluna status para ENUM...');
    if (await migrateStatusToEnum()) {
      changesCount++;
    }

    // Adiciona índice de telefone
    logStep(3, 7, 'Criando índice idx_telefone...');
    if (await createIndex('purchase_histories', 'idx_telefone', 'telefone')) {
      changesCount++;
    }

    // Adiciona índice de dataTransacao
    logStep(4, 7, 'Criando índice idx_dataTransacao...');
    if (await createIndex('purchase_histories', 'idx_dataTransacao', 'dataTransacao')) {
      changesCount++;
    }

    // Adiciona índice composto
    logStep(5, 7, 'Criando índice composto idx_telefone_dataTransacao...');
    if (await createIndex('purchase_histories', 'idx_telefone_dataTransacao', ['telefone', 'dataTransacao'])) {
      changesCount++;
    }

    // Adiciona índice de status
    logStep(6, 7, 'Criando índice idx_status...');
    if (await createIndex('purchase_histories', 'idx_status', 'status')) {
      changesCount++;
    }

    // Adiciona UNIQUE constraint em transactionId
    logStep(7, 7, 'Adicionando constraint UNIQUE ao transactionId...');
    if (await addUniqueConstraintToTransactionId()) {
      changesCount++;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    log('\n' + '='.repeat(60), 'bright');
    log('MIGRAÇÃO CONCLUÍDA COM SUCESSO!', 'green');
    log('='.repeat(60), 'bright');
    logSuccess(`${changesCount} alteração(ões) aplicada(s)`);
    logSuccess(`Tempo decorrido: ${elapsed}s`);

    if (changesCount === 0) {
      logInfo('Banco de dados já estava atualizado');
    }

    log('\n📋 PRÓXIMOS PASSOS:', 'cyan');
    log('1. Reinicie a aplicação: npm start', 'cyan');
    log('2. Verifique os logs para confirmar que tudo funcionou', 'cyan');
    log('3. Teste as funcionalidades principais', 'cyan');
    log('');

  } catch (error) {
    log('\n' + '='.repeat(60), 'bright');
    log('MIGRAÇÃO FALHOU!', 'red');
    log('='.repeat(60), 'bright');
    logError(`Erro: ${error.message}`);

    log('\n🔧 TROUBLESHOOTING:', 'yellow');
    log('1. Verifique se o arquivo .env está configurado corretamente', 'yellow');
    log('2. Confirme que o MySQL está rodando', 'yellow');
    log('3. Verifique as credenciais do banco de dados', 'yellow');
    log('4. Consulte o DEPLOY-GUIDE.md para mais informações', 'yellow');
    log('');

    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Executa migração
runMigration();
