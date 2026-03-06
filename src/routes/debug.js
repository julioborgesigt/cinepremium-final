'use strict';

const express = require('express');
const { sequelize } = require('../../models');
const { requireLogin } = require('../middlewares/auth');
const { debugLogs, pixCodesCache, cachedActiveGateway: getCachedActiveGateway } = require('../services/ciabraService');
const { getRedisClient, getSessionStore } = require('../config/redis');
const { isInitialized: isFirebaseInitialized } = require('../services/firebaseService');

const router = express.Router();

// GET /health — health check público para monitoramento
router.get('/health', async (req, res) => {
    const startTime = Date.now();
    const healthCheck = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks: { database: 'unknown', memory: 'ok' }
    };

    try {
        await sequelize.authenticate();
        healthCheck.checks.database = 'ok';

        const memUsage = process.memoryUsage();
        const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        if (heapUsedPercent > 90) {
            healthCheck.checks.memory = 'warning';
            healthCheck.status = 'degraded';
        }

        healthCheck.responseTime = Date.now() - startTime;
        const statusCode = healthCheck.status === 'ok' ? 200 : 503;
        res.status(statusCode).json(healthCheck);
    } catch (error) {
        healthCheck.status = 'error';
        healthCheck.checks.database = 'error';
        healthCheck.error = error.message;
        healthCheck.responseTime = Date.now() - startTime;
        console.error('[Health Check] Erro:', error);
        res.status(503).json(healthCheck);
    }
});

// GET /debug-logs — logs de debug do servidor (público — ver auditoria item 1.1)
router.get('/debug-logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json({
        timestamp: new Date().toISOString(),
        server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            activeGateway: getCachedActiveGateway()
        },
        cache: {
            pixCodesSize: pixCodesCache.size,
            pixCodes: Array.from(pixCodesCache.keys())
        },
        logs: {
            total: debugLogs.length,
            showing: Math.min(limit, debugLogs.length),
            entries: debugLogs.slice(-limit)
        }
    });
});

// GET /api/diagnostics — diagnóstico completo (protegido)
router.get('/api/diagnostics', requireLogin, async (req, res) => {
    try {
        const redisClient = getRedisClient();
        const sessionStore = getSessionStore();

        const diagnostics = {
            environment: {
                NODE_ENV: process.env.NODE_ENV || 'não definido',
                USE_REDIS: process.env.USE_REDIS || 'não definido',
                PORT: process.env.PORT || 'não definido'
            },
            redis: {
                url_configured: !!process.env.REDIS_URL,
                url_preview: process.env.REDIS_URL ? process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@') : 'não definido',
                client_connected: !!redisClient,
                store_configured: !!sessionStore,
                should_use_redis: process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true'
            },
            session: {
                secret_configured: !!process.env.SESSION_SECRET,
                store_type: sessionStore ? 'RedisStore' : 'MemoryStore',
                cookie_domain: process.env.COOKIE_DOMAIN || 'não definido'
            },
            database: {
                host: process.env.DB_HOST || 'não definido',
                name: process.env.DB_NAME || 'não definido',
                user_configured: !!process.env.DB_USER
            },
            ciabra: {
                public_key_configured: !!process.env.CIABRA_PUBLIC_KEY,
                private_key_configured: !!process.env.CIABRA_PRIVATE_KEY,
                webhook_url: process.env.CIABRA_WEBHOOK_URL || 'não definido'
            },
            payment: { active_gateway: getCachedActiveGateway() || 'não carregado ainda' },
            firebase: { initialized: isFirebaseInitialized(), project_id: process.env.FIREBASE_PROJECT_ID || 'não definido' }
        };

        if (redisClient) {
            try {
                const keys = await redisClient.keys('cinepremium:sess:*');
                diagnostics.redis.active_sessions = keys.length;
            } catch (err) {
                diagnostics.redis.active_sessions_error = err.message;
            }
        }

        res.json(diagnostics);
    } catch (error) {
        console.error('Erro ao gerar diagnóstico:', error);
        res.status(500).json({ error: 'Erro ao gerar diagnóstico' });
    }
});

// GET /api/firebase-config — configurações públicas do Firebase para o frontend
router.get('/api/firebase-config', (req, res) => {
    try {
        const firebaseConfig = {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID,
            vapidKey: process.env.FIREBASE_VAPID_KEY
        };

        const missingVars = Object.entries(firebaseConfig).filter(([, value]) => !value).map(([key]) => key);
        if (missingVars.length > 0) {
            console.warn(`[Firebase Config] Variáveis faltando: ${missingVars.join(', ')}`);
            if (process.env.NODE_ENV !== 'production') {
                return res.json({ apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: '', vapidKey: '' });
            }
            return res.status(500).json({ error: 'Configuração do Firebase incompleta no servidor.' });
        }

        res.json(firebaseConfig);
    } catch (error) {
        console.error('[Firebase Config] Erro ao processar configuração:', error);
        res.status(500).json({ error: 'Erro ao buscar configuração do Firebase' });
    }
});

// GET /api/csrf-token — fornece CSRF token para o frontend
router.get('/api/csrf-token', (req, res) => {
    try {
        const csrfProtection = req.app.get('csrfProtection');
        if (!csrfProtection) {
            return res.status(503).json({ error: 'CSRF protection não inicializado' });
        }
        csrfProtection(req, res, () => {
            res.json({ csrfToken: req.csrfToken() });
        });
    } catch (error) {
        console.error('[CSRF Token] Erro ao gerar token:', error);
        res.status(500).json({ error: 'Erro ao gerar CSRF token' });
    }
});

module.exports = router;
