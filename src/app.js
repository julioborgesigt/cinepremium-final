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
        ? (process.env.ALLOWED_ORIGINS
            ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
            : false) // fail-closed: sem ALLOWED_ORIGINS, bloqueia cross-origin
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

// Body parsers com limite explícito de tamanho
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));

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
    if (!sessionMiddleware) {
        console.warn(`[AVISO] Requisição ${req.path} antes de session middleware estar pronto!`);
        return next();
    }
    // Erro no store de sessão (ex: Redis caiu em runtime) NÃO deve derrubar a requisição
    // inteira com 500. Sem este guard, qualquer instabilidade do Redis gera HTML 500 em
    // TODAS as rotas (inclusive /api/products e /api/csrf-token, que nem usam sessão).
    // Aqui, se o store falhar, prosseguimos sem sessão persistida: o site público (produtos,
    // CSRF via cookie, pagamento) continua funcionando; apenas o login admin não persiste.
    sessionMiddleware(req, res, (err) => {
        if (err) {
            console.error(`[SESSION] Falha no store de sessão em ${req.path}: ${err.message}. Prosseguindo sem sessão persistida.`);
            return next();
        }
        next();
    });
});

// Debug de sessão (apenas quando DEBUG_SESSION=true, nunca por padrão em produção)
if (process.env.DEBUG_SESSION === 'true') {
    app.use((req, res, next) => {
        if (req.path === '/auth' || req.path === '/admin') {
            console.log('[SESSION DEBUG]', {
                path: req.path,
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
