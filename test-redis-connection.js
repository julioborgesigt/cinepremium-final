// Script para testar conexão e visualizar sessões no Redis
// Tenta carregar .env se existir (desenvolvimento local)
try {
  require('dotenv').config();
} catch (e) {
  // Ignora se dotenv não estiver disponível ou .env não existir
}

const { createClient } = require('redis');

async function testRedis() {
  console.log('🔍 Testando conexão com Redis...\n');

  // Aceita REDIS_URL do ambiente OU do argumento da linha de comando
  const redisUrl = process.env.REDIS_URL || process.argv[2];

  if (!redisUrl) {
    console.error('❌ REDIS_URL não está definido!');
    console.error('\n💡 Soluções:');
    console.error('   1. Defina a variável de ambiente: export REDIS_URL="redis://..."');
    console.error('   2. Passe como argumento: npm run test-redis redis://...');
    console.error('   3. Configure no .env (desenvolvimento): REDIS_URL=redis://...\n');
    process.exit(1);
  }

  console.log(`📦 Conectando a: ${redisUrl.replace(/:[^:@]+@/, ':****@')}\n`);

  const client = createClient({ url: redisUrl });

  client.on('error', (err) => console.error('❌ Erro:', err));

  try {
    await client.connect();
    console.log('✅ Conectado ao Redis com sucesso!\n');

    // 1. Testar PING
    const pong = await client.ping();
    console.log(`1️⃣ PING: ${pong}`);

    // 2. Contar sessões
    const keys = await client.keys('cinepremium:sess:*');
    console.log(`\n2️⃣ Sessões ativas: ${keys.length}`);

    if (keys.length > 0) {
      console.log('\n📋 Sessões encontradas:');

      for (const key of keys) {
        console.log(`\n   Key: ${key}`);

        // Pegar TTL (tempo de vida restante)
        const ttl = await client.ttl(key);
        const hours = Math.floor(ttl / 3600);
        const minutes = Math.floor((ttl % 3600) / 60);
        console.log(`   ⏱️  TTL: ${hours}h ${minutes}m (expira em ${hours}h${minutes}m)`);

        // Pegar dados da sessão
        const sessionData = await client.get(key);
        if (sessionData) {
          try {
            const parsed = JSON.parse(sessionData);
            console.log(`   👤 Logado: ${parsed.loggedin ? 'SIM' : 'NÃO'}`);
            if (parsed.cookie) {
              const expires = new Date(parsed.cookie.expires);
              console.log(`   🍪 Expira em: ${expires.toLocaleString('pt-BR')}`);
            }
          } catch (e) {
            console.log(`   📄 Dados (raw): ${sessionData.substring(0, 100)}...`);
          }
        }
      }
    } else {
      console.log('\n💡 Nenhuma sessão ativa encontrada.');
      console.log('   Isso é normal se ninguém está logado no momento.');
    }

    // 3. Info sobre o Redis
    console.log('\n3️⃣ Informações do Redis:');
    const info = await client.info('memory');
    const usedMemory = info.match(/used_memory_human:(.+)/);
    if (usedMemory) {
      console.log(`   💾 Memória usada: ${usedMemory[1].trim()}`);
    }

    // 4. Testar escrita
    console.log('\n4️⃣ Testando escrita...');
    await client.set('cinepremium:test', 'Funcionando!', { EX: 60 });
    const testValue = await client.get('cinepremium:test');
    console.log(`   ✅ Escrita OK: "${testValue}"`);
    await client.del('cinepremium:test');
    console.log('   🗑️  Teste limpo');

    console.log('\n✅ REDIS ESTÁ FUNCIONANDO PERFEITAMENTE!\n');

  } catch (error) {
    console.error('\n❌ ERRO:', error.message);
    process.exit(1);
  } finally {
    await client.quit();
  }
}

testRedis();
