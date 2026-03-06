'use strict';

const session = require('express-session');

/**
 * Cria o middleware de sessão com o store fornecido.
 * Deve ser chamado APÓS initializeRedis() para garantir que sessionStore esteja pronto.
 * @param {object|null} sessionStore - RedisStore ou null para MemoryStore
 */
function createSessionMiddleware(sessionStore) {
    return session({
        store: sessionStore || undefined,
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        name: 'sessionId',
        proxy: true,
        cookie: {
            maxAge: 8 * 60 * 60 * 1000, // 8 horas
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            domain: process.env.COOKIE_DOMAIN || undefined
        }
    });
}

module.exports = { createSessionMiddleware };
