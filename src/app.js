'use strict';

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');

const { globalLimiter } = require('./middlewares/rateLimiters');
const { registerRoutes } = require('./routes/index');

const app = express();

// Confia no proxy reverso (necessário para DomCloud, Heroku, etc.)
app.set('trust proxy', 1);

// CORS
const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
        ? process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim())
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Helmet com CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'", // TODO: Remover após migrar scripts inline para arquivos externos
                'https://www.gstatic.com',
                'https://apis.google.com',
                'https://cdn.jsdelivr.net'
            ],
            connectSrc: [
                "'self'",
                'https://www.gstatic.com',
                'https://fcm.googleapis.com',
                'https://fcmregistrations.googleapis.com',
                'https://firebaseinstallations.googleapis.com',
                'https://api.az.center'
            ],
            imgSrc: ["'self'", 'data:', 'https:'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'", 'data:', 'https:'],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false // Necessário para Firebase
}));

// Rate limiting global
app.use(globalLimiter);

// Body parsers
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Compressão Gzip/Brotli
app.use(compression());

// Arquivos estáticos com cache de 7 dias (exceto HTML)
app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
        if (path.extname(filePath) === '.html') {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Cookie parser (deve vir antes da sessão)
app.use(cookieParser());

// Placeholder para o middleware de sessão dinâmico.
// Será substituído pelo middleware real em startServer() após Redis conectar.
app.use((req, res, next) => {
    const sessionMiddleware = app.get('sessionMiddleware');
    if (sessionMiddleware) {
        return sessionMiddleware(req, res, next);
    }
    console.warn(`[AVISO] Requisição ${req.path} antes de session middleware estar pronto!`);
    next();
});

// Debug de sessão em produção
if (process.env.NODE_ENV === 'production' || process.env.DEBUG_SESSION === 'true') {
    app.use((req, res, next) => {
        if (req.path === '/auth' || req.path === '/admin') {
            console.log('[SESSION DEBUG]', {
                path: req.path,
                protocol: req.protocol,
                secure: req.secure,
                hostname: req.hostname,
                sessionID: req.sessionID,
                hasSession: !!req.session,
                loggedin: req.session?.loggedin
            });
        }
        next();
    });
}

// Registra todas as rotas
registerRoutes(app);

module.exports = app;
