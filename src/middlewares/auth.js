'use strict';

/**
 * Middleware que protege rotas: verifica se o usuário está logado.
 * Para rotas /api/, retorna 401 JSON. Para outras, redireciona para /login.
 */
function requireLogin(req, res, next) {
    if (req.session && req.session.loggedin) {
        next();
    } else {
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ error: 'Sua sessão expirou, faça o login novamente.' });
        } else {
            res.redirect('/login');
        }
    }
}

/**
 * Wrapper para CSRF que só aplica se o middleware estiver inicializado.
 * Fail-closed: rejeita a requisição se CSRF não estiver pronto.
 */
function makeApplyCsrf(getCsrfProtection) {
    return function applyCsrf(req, res, next) {
        const csrfProtection = getCsrfProtection();
        if (csrfProtection) {
            csrfProtection(req, res, next);
        } else {
            console.error('[CSRF] Middleware não inicializado — requisição bloqueada');
            res.status(503).json({ error: 'Servidor ainda inicializando. Tente novamente em alguns segundos.' });
        }
    };
}

module.exports = { requireLogin, makeApplyCsrf };
