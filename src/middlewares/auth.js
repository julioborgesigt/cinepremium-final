'use strict';

/**
 * Middleware que protege rotas: verifica se o usuário está logado.
 * Para rotas /api/, retorna 401 JSON. Para outras, redireciona para /login.
 */
function requireLogin(req, res, next) {
    if (process.env.NODE_ENV !== 'production') {
        console.log('[REQUIRE_LOGIN] Path:', req.path);
        console.log('[REQUIRE_LOGIN] Has session:', !!req.sessionID);
        console.log('[REQUIRE_LOGIN] Session loggedin:', req.session.loggedin);
    }

    if (req.session.loggedin) {
        if (process.env.NODE_ENV !== 'production') {
            console.log('[REQUIRE_LOGIN] ✅ Acesso permitido');
        }
        next();
    } else {
        console.log('[REQUIRE_LOGIN] ❌ Sessão não encontrada ou expirada');
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ error: 'Sua sessão expirou, faça o login novamente.' });
        } else {
            res.redirect('/login');
        }
    }
}

/**
 * Wrapper para CSRF que só aplica se o middleware estiver inicializado.
 * O csrfProtection é injetado via closure pelo startServer() depois da sessão estar pronta.
 */
function makeApplyCsrf(getCsrfProtection) {
    return function applyCsrf(req, res, next) {
        const csrfProtection = getCsrfProtection();
        if (csrfProtection) {
            csrfProtection(req, res, next);
        } else {
            console.warn('[CSRF] Middleware ainda não inicializado, pulando proteção');
            next();
        }
    };
}

module.exports = { requireLogin, makeApplyCsrf };
