'use strict';

const { doubleCsrfProtection, generateCsrfToken } = require('./config/csrf');
const app = require('./app');
const { initializeRedis, getSessionStore, getRedisClient } = require('./config/redis');
const { createSessionMiddleware } = require('./config/session');
const { makeApplyCsrf } = require('./middlewares/auth');
const { initFirebase } = require('./services/firebaseService');
const { CIABRA_PUBLIC_KEY, CIABRA_PRIVATE_KEY } = require('./services/ciabraService');
const { sequelize } = require('../models');

const PORT = process.env.PORT || 3000;

/**
 * Conecta ao banco com retry e backoff exponencial.
 * Tolera blips transitórios de rede no boot — sem isso, uma falha momentânea
 * fazia process.exit(1) e derrubava o site até um redeploy manual.
 * Uma falha persistente (ex: senha errada) ainda aborta após as tentativas.
 */
async function connectToDatabaseWithRetry(maxAttempts = 4) {
    const delays = [2000, 4000, 8000]; // 2s, 4s, 8s entre as tentativas
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await sequelize.authenticate();
            console.log(`Conexão com o banco de dados estabelecida com sucesso${attempt > 1 ? ` (tentativa ${attempt})` : ''}.`);
            return;
        } catch (error) {
            console.error(`❌ Falha ao conectar ao banco (tentativa ${attempt}/${maxAttempts}): ${error.message}`);
            if (attempt === maxAttempts) throw error;
            const delayMs = delays[attempt - 1];
            console.log(`⏳ Nova tentativa de conexão ao banco em ${delayMs / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

async function startServer() {
    try {
        console.log('Inicializando servidor...');

        // 0. Validação de variáveis críticas
        if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
            throw new Error('SESSION_SECRET deve ser definido com pelo menos 32 caracteres.');
        }
        if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
            throw new Error('ADMIN_USER e ADMIN_PASS devem ser definidos.');
        }
        if (process.env.ADMIN_PASS && !process.env.ADMIN_PASS.startsWith('$2')) {
            console.warn('[SEGURANÇA] ADMIN_PASS não parece ser um hash bcrypt válido.');
        }
        if (process.env.NODE_ENV === 'production' && !process.env.CIABRA_WEBHOOK_URL) {
            console.warn('[SEGURANÇA] CIABRA_WEBHOOK_URL não definido — webhooks não funcionarão.');
        }
        if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
            console.warn('[SEGURANÇA] ALLOWED_ORIGINS não definido — CORS rejeitará requisições cross-origin.');
        }

        // 1. Testa conexão com banco de dados (com retry para blips transitórios)
        await connectToDatabaseWithRetry();

        // 2. Inicializa Firebase (não bloqueia)
        initFirebase();

        // 3. Inicializa Redis
        await initializeRedis();

        // 4. Cria middleware de sessão APÓS Redis estar pronto
        const sessionStore = getSessionStore();
        const sessionMiddleware = createSessionMiddleware(sessionStore);
        app.set('sessionMiddleware', sessionMiddleware);
        console.log(`Middleware de sessão configurado (${sessionStore ? 'RedisStore' : 'MemoryStore'})`);

        // 5. Configura CSRF protection (csrf-csrf / double-submit) e disponibiliza
        //    para as rotas via app.set
        app.set('csrfProtection', doubleCsrfProtection);
        app.set('generateCsrfToken', generateCsrfToken);

        // Cria applyCsrf usando o getter para evitar dependência circular
        const applyCsrf = makeApplyCsrf(() => app.get('csrfProtection'));
        app.set('applyCsrf', applyCsrf);
        console.log('✅ CSRF protection configurado (csrf-csrf / double-submit)');

        // 5. Verifica credenciais CIABRA
        if (CIABRA_PUBLIC_KEY && CIABRA_PRIVATE_KEY) {
            console.log('✅ Credenciais CIABRA configuradas');
        } else {
            console.warn('⚠️ Credenciais CIABRA não configuradas. Configure CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY no .env');
        }

        // 6. Inicia o servidor HTTP
        const server = app.listen(PORT, () => {
            console.log(`✅ Servidor rodando na porta ${PORT}`);
            console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🗄️  Sessões: ${sessionStore ? 'Redis (persistente)' : 'Memória (volátil)'}`);
            console.log('✨ Sistema pronto para receber requisições');
        });

        // 7. Graceful shutdown
        const gracefulShutdown = async (signal) => {
            console.log(`\n🛑 ${signal} recebido. Iniciando graceful shutdown...`);
            server.close(async () => {
                console.log('📡 Servidor HTTP fechado (não aceita mais conexões)');
                try {
                    await sequelize.close();
                    console.log('🗄️  Conexão com banco de dados fechada');

                    // node-redis v5: quit() retorna Promise e NÃO aceita callback. A versão
                    // anterior passava um callback que nunca era chamado, travando o shutdown
                    // até o timeout de 30s. O client do store é o mesmo objeto retornado aqui.
                    const redisClient = getRedisClient();
                    if (redisClient) {
                        try {
                            await redisClient.quit();
                            console.log('🔴 Conexão com Redis fechada');
                        } catch (redisCloseError) {
                            console.warn('⚠️  Erro ao fechar Redis, forçando:', redisCloseError.message);
                            try { await redisClient.destroy(); } catch (_) { /* já desconectado */ }
                        }
                    }

                    console.log('✅ Graceful shutdown concluído');
                    process.exit(0);
                } catch (error) {
                    console.error('❌ Erro durante graceful shutdown:', error);
                    process.exit(1);
                }
            });

            setTimeout(() => {
                console.error('⚠️  Graceful shutdown timeout. Forçando saída...');
                process.exit(1);
            }, 30000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    } catch (error) {
        console.error('❌ Erro ao inicializar servidor:', error);
        console.error('💥 O servidor não foi iniciado devido a erros críticos');
        process.exit(1);
    }
}

module.exports = { startServer };
