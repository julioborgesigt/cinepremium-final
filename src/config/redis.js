'use strict';

const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');

let redisClient = null;
let sessionStore = null;

async function initializeRedis() {
    console.log('[DEBUG] Verificando condições para usar Redis:');
    console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'não definido'}`);
    console.log(`  USE_REDIS: ${process.env.USE_REDIS || 'não definido'}`);

    const shouldUseRedis =
        process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true';
    console.log(`  Resultado: ${shouldUseRedis ? 'USAR REDIS' : 'USAR MEMORYSTORE'}`);

    if (!shouldUseRedis) {
        console.warn('⚠️ Usando MemoryStore para sessões (apenas desenvolvimento)');
        console.warn('💡 Para produção, configure NODE_ENV=production ou USE_REDIS=true');
        return; // sessionStore fica null; Express usa MemoryStore
    }

    try {
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        console.log(`📦 Conectando ao Redis: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`);

        redisClient = createClient({
            url: redisUrl,
            socket: {
                connectTimeout: 10000,
                reconnectStrategy: (retries) => {
                    if (retries > 10) {
                        console.error('❌ Redis: Máximo de tentativas de reconexão atingido');
                        return new Error('Máximo de tentativas de reconexão atingido');
                    }
                    const delay = Math.min(retries * 100, 3000);
                    console.log(`🔄 Redis: Tentando reconectar em ${delay}ms (tentativa ${retries})`);
                    return delay;
                }
            }
        });

        redisClient.on('error', (err) => {
            console.error('❌ Erro no Redis:', err.message || err);
        });
        redisClient.on('connect', () => {
            console.log('✅ Redis conectado com sucesso');
        });
        redisClient.on('ready', () => {
            console.log('✅ Redis pronto para uso');
        });

        console.log('[DEBUG] Chamando redisClient.connect()...');
        await redisClient.connect();
        console.log('[DEBUG] redisClient.connect() completou com sucesso');

        sessionStore = new RedisStore({
            client: redisClient,
            prefix: 'cinepremium:sess:',
            ttl: 8 * 60 * 60 // 8 horas em segundos
        });
        console.log('✅ RedisStore configurado e pronto');

    } catch (error) {
        console.error('❌ FALHA AO CONECTAR AO REDIS:');
        console.error('   Tipo do erro:', error.constructor.name);
        console.error('   Mensagem:', error.message);
        console.error('   Code:', error.code);
        if (error.stack) {
            console.error('   Stack trace:', error.stack.split('\n').slice(0, 3).join('\n'));
        }
        // Por padrão, mantém o site no ar com MemoryStore (sessões voláteis) mesmo em
        // produção — um blip no Redis Cloud não deve derrubar o site inteiro.
        // Para exigir Redis (fail-closed) e abortar a inicialização, defina REDIS_REQUIRED=true.
        if (process.env.NODE_ENV === 'production' && process.env.REDIS_REQUIRED === 'true') {
            throw error;
        }

        // Garante que o client órfão não fique tentando reconectar em segundo plano
        if (redisClient) {
            try { await redisClient.destroy(); } catch (e) { /* já desconectado */ }
        }

        if (process.env.NODE_ENV === 'production') {
            console.error('🚨 [PRODUÇÃO] Redis indisponível — usando MemoryStore (sessões serão perdidas a cada restart). Verifique o Redis!');
        } else {
            console.warn('⚠️ Usando MemoryStore como fallback (apenas desenvolvimento)');
        }
        redisClient = null;
        sessionStore = null;
    }
}

function getRedisClient() {
    return redisClient;
}

function getSessionStore() {
    return sessionStore;
}

module.exports = { initializeRedis, getRedisClient, getSessionStore };
