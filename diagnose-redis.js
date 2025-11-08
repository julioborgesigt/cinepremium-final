// Script para verificar se Redis está sendo usado pela aplicação
require('dotenv').config();

console.log('🔍 Verificando configuração Redis da aplicação...\n');

// 1. Verifica variável de ambiente
console.log('1️⃣ Variável REDIS_URL:');
const redisUrl = process.env.REDIS_URL;
if (redisUrl) {
  console.log(`   ✅ Definida: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`);
} else {
  console.log('   ❌ NÃO definida');
}
console.log('');

// 2. Verifica NODE_ENV
console.log('2️⃣ NODE_ENV:');
console.log(`   ${process.env.NODE_ENV || 'não definido (padrão: development)'}`);
console.log('');

// 3. Verifica USE_REDIS
console.log('3️⃣ USE_REDIS:');
console.log(`   ${process.env.USE_REDIS || 'não definido'}`);
console.log('');

// 4. Verifica se deveria usar Redis baseado na lógica do server.js
console.log('4️⃣ Condição para usar Redis:');
const shouldUseRedis = process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true';
console.log(`   (NODE_ENV === 'production' || USE_REDIS === 'true')`);
console.log(`   Resultado: ${shouldUseRedis ? '✅ SIM' : '❌ NÃO'}`);
console.log('');

if (!shouldUseRedis) {
  console.log('⚠️  PROBLEMA ENCONTRADO:');
  console.log('   A aplicação NÃO vai usar Redis com as configurações atuais!');
  console.log('');
  console.log('💡 SOLUÇÃO:');
  console.log('   Adicione ao seu YML:');
  console.log('   env_var_list:');
  console.log('     - NODE_ENV=production');
  console.log('   OU');
  console.log('     - USE_REDIS=true');
  console.log('');
}

// 5. Testa conexão se URL estiver definida
if (redisUrl) {
  console.log('5️⃣ Testando conexão Redis...');
  const { createClient } = require('redis');
  const client = createClient({ url: redisUrl });

  client.connect()
    .then(() => {
      console.log('   ✅ Conexão bem-sucedida!');
      return client.ping();
    })
    .then((pong) => {
      console.log(`   ✅ PING: ${pong}`);
      return client.quit();
    })
    .then(() => {
      console.log('');
      console.log('✅ Redis está configurado e acessível!');
      if (shouldUseRedis) {
        console.log('✅ A aplicação DEVERIA estar usando Redis para sessões.');
        console.log('');
        console.log('🔍 Se ainda não aparecem sessões, verifique:');
        console.log('   1. Reinicie a aplicação: touch tmp/restart.txt');
        console.log('   2. Verifique os logs: tail -f ~/logs/passenger.log');
        console.log('   3. Faça login novamente no admin');
      }
    })
    .catch((err) => {
      console.error('   ❌ Erro ao conectar:', err.message);
      console.log('');
      console.log('⚠️  Redis não está acessível!');
      console.log('   Verifique se REDIS_URL está correto.');
    });
} else {
  console.log('❌ REDIS_URL não está definido - sessões usarão MemoryStore');
}
