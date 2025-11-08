// Script de diagnóstico detalhado de conexão Redis
require('dotenv').config();
const { createClient } = require('redis');

async function testRedisConnection() {
  console.log('🔍 DIAGNÓSTICO COMPLETO DE CONEXÃO REDIS\n');
  console.log('=' . repeat(60));

  // 1. Verificar variáveis
  console.log('\n1️⃣ VARIÁVEIS DE AMBIENTE:');
  console.log('   REDIS_URL definido:', !!process.env.REDIS_URL);

  if (!process.env.REDIS_URL) {
    console.error('   ❌ REDIS_URL não está definido!');
    return;
  }

  const redisUrl = process.env.REDIS_URL;
  console.log('   URL (mascarada):', redisUrl.replace(/:[^:@]+@/, ':****@'));

  // Parse da URL
  try {
    const url = new URL(redisUrl);
    console.log('\n   Parsed URL:');
    console.log('   - Protocol:', url.protocol);
    console.log('   - Host:', url.hostname);
    console.log('   - Port:', url.port);
    console.log('   - Username:', url.username || 'default');
    console.log('   - Has password:', !!url.password);
  } catch (e) {
    console.error('   ❌ URL mal formatada:', e.message);
    return;
  }

  // 2. Testar conexão simples
  console.log('\n2️⃣ TESTE DE CONEXÃO SIMPLES:');

  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 15000,
      reconnectStrategy: false // Desabilita reconnect para ver erro rapidamente
    }
  });

  // Event listeners detalhados
  client.on('error', (err) => {
    console.error('\n   ❌ ERRO DO CLIENTE:', {
      name: err.name,
      message: err.message,
      code: err.code,
      errno: err.errno,
      syscall: err.syscall
    });
  });

  client.on('connect', () => {
    console.log('   ✅ Evento "connect" disparado');
  });

  client.on('ready', () => {
    console.log('   ✅ Evento "ready" disparado');
  });

  client.on('reconnecting', () => {
    console.log('   🔄 Tentando reconectar...');
  });

  client.on('end', () => {
    console.log('   ⚠️  Conexão encerrada');
  });

  try {
    console.log('   Iniciando conexão...');
    const startTime = Date.now();

    await client.connect();

    const connectTime = Date.now() - startTime;
    console.log(`   ✅ CONECTADO COM SUCESSO em ${connectTime}ms!`);

    // 3. Testar comandos
    console.log('\n3️⃣ TESTE DE COMANDOS:');

    const pingStart = Date.now();
    const pong = await client.ping();
    console.log(`   ✅ PING: ${pong} (${Date.now() - pingStart}ms)`);

    const setStart = Date.now();
    await client.set('test:connection', 'success', { EX: 60 });
    console.log(`   ✅ SET: OK (${Date.now() - setStart}ms)`);

    const getStart = Date.now();
    const value = await client.get('test:connection');
    console.log(`   ✅ GET: ${value} (${Date.now() - getStart}ms)`);

    await client.del('test:connection');
    console.log('   ✅ DEL: OK');

    // 4. Testar sessões
    console.log('\n4️⃣ TESTE DE SESSÕES:');
    const keys = await client.keys('cinepremium:sess:*');
    console.log(`   Sessões existentes: ${keys.length}`);
    if (keys.length > 0) {
      console.log('   Keys:', keys);
    }

    console.log('\n✅ REDIS ESTÁ FUNCIONANDO PERFEITAMENTE!');
    console.log('=' . repeat(60));

    await client.quit();

  } catch (error) {
    console.error('\n❌ FALHA NA CONEXÃO:');
    console.error('=' . repeat(60));
    console.error('Tipo:', error.constructor.name);
    console.error('Mensagem:', error.message);

    if (error.code) console.error('Code:', error.code);
    if (error.errno) console.error('Errno:', error.errno);
    if (error.syscall) console.error('Syscall:', error.syscall);
    if (error.address) console.error('Address:', error.address);
    if (error.port) console.error('Port:', error.port);

    console.error('\n📝 Stack trace:');
    console.error(error.stack);

    console.error('\n💡 POSSÍVEIS CAUSAS:');

    if (error.code === 'ECONNREFUSED') {
      console.error('   - Redis não está rodando no host/porta especificado');
      console.error('   - Firewall bloqueando a porta');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
      console.error('   - Timeout de conexão (rede lenta ou firewall)');
      console.error('   - Redis Cloud pode estar bloqueando o IP');
    } else if (error.code === 'ENOTFOUND') {
      console.error('   - Hostname inválido na REDIS_URL');
    } else if (error.message.includes('WRONGPASS') || error.message.includes('NOAUTH')) {
      console.error('   - Senha incorreta');
      console.error('   - Verifique a senha no Redis Cloud dashboard');
    } else if (error.message.includes('SSL') || error.message.includes('TLS')) {
      console.error('   - Problema com SSL/TLS');
      console.error('   - Tente adicionar ?tls=true ou rediss:// na URL');
    }

    console.error('=' . repeat(60));

    try {
      await client.quit();
    } catch (e) {
      // Ignora erro ao fechar
    }

    process.exit(1);
  }
}

testRedisConnection();
