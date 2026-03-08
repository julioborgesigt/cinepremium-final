'use strict';

const rateLimit = require('express-rate-limit');

// Rate limiting global (todas as rotas)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 500, // 500 requisições por IP
    message: 'Muitas requisições deste IP, tente novamente em 15 minutos.'
});

// Rate limiting para login (proteção contra força bruta)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 tentativas de login
    message: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    skipSuccessfulRequests: true
});

// Rate limiting para webhook (proteção contra replay attacks e DoS)
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 30, // 30 webhooks por minuto
    message: 'Muitos webhooks recebidos. Tente novamente em 1 minuto.',
    standardHeaders: true,
    legacyHeaders: false
});

// Rate limiting para verificação de status (proteção contra DoS)
const statusCheckLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 60, // 60 verificações por minuto
    message: 'Muitas verificações de status. Aguarde um momento.',
    standardHeaders: true,
    legacyHeaders: false
});

// Rate limiting por IP para geração de QR code (proteção contra abuso)
const qrCodeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10, // 10 gerações por IP por hora
    message: 'Muitas tentativas de geração de QR Code deste IP. Tente novamente mais tarde.',
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { globalLimiter, loginLimiter, webhookLimiter, statusCheckLimiter, qrCodeLimiter };
