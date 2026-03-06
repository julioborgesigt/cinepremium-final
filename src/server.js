'use strict';

const csrf = require('csurf');
const app = require('./app');
const { initializeRedis, getSessionStore, getRedisClient } = require('./config/redis');
const { createSessionMiddleware } = require('./config/session');
const { makeApplyCsrf } = require('./middlewares/auth');
const { initFirebase } = require('./services/firebaseService');
const { CIABRA_PUBLIC_KEY, CIABRA_PRIVATE_KEY } = require('./services/ciabraService');
const { sequelize } = require('../models');

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        console.log('🚀 Inicializando servidor...');
        console.log('✅ Servidor iniciando com variáveis de ambiente do Passenger...');

        // 1. Inicializa Firebase (não bloqueia)
        initFirebase();

        // 2. Inicializa Redis
        console.log('📦 Inicializando Redis...');
        await initializeRedis();

        // 3. Cria middleware de sessão APÓS Redis estar pronto
        const sessionStore = getSessionStore();
        console.log(`[DEBUG] sessionStore definido: ${!!sessionStore}`);
        const sessionMiddleware = createSessionMiddleware(sessionStore);
        app.set('sessionMiddleware', sessionMiddleware);
        console.log(`✅ Middleware de sessão configurado (${sessionStore ? 'RedisStore' : 'MemoryStore'})`);

        // 4. Configura CSRF protection e disponibiliza para as rotas via app.set
        const csrfProtection = csrf({
            cookie: {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict'
            }
        });
        app.set('csrfProtection', csrfProtection);

        // Cria applyCsrf usando o getter para evitar dependência circular
        const applyCsrf = makeApplyCsrf(() => app.get('csrfProtection'));
        app.set('applyCsrf', applyCsrf);
        console.log('✅ CSRF protection configurado');

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

                    const redisClient = getRedisClient();
                    const store = getSessionStore();
                    if (store && store.client) {
                        await new Promise((resolve) => {
                            store.client.quit(() => {
                                console.log('🔴 Conexão com Redis fechada');
                                resolve();
                            });
                        });
                    } else if (redisClient) {
                        await redisClient.quit();
                        console.log('🔴 Conexão com Redis fechada');
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
