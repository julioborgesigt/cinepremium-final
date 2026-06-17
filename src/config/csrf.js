'use strict';

const { doubleCsrf } = require('csrf-csrf');

/**
 * Proteção CSRF via padrão double-submit cookie com token assinado por HMAC.
 * Substitui o `csurf` (arquivado/sem manutenção e com CVE transitivo no `cookie`).
 *
 * Decisões:
 * - getSecret reusa SESSION_SECRET (já validado com >=32 chars no boot), a menos
 *   que CSRF_SECRET seja definido separadamente. Isso evita exigir uma nova env
 *   var obrigatória e quebrar o deploy.
 * - getSessionIdentifier retorna '' de propósito: o checkout é público (sem sessão)
 *   e o login regenera a sessão; vincular o token à sessão invalidaria tokens
 *   legítimos no meio do fluxo. A proteção vem do cookie SameSite + HMAC do token.
 * - O token é lido do header 'CSRF-Token' (o que o frontend já envia), com fallbacks.
 */
const isProd = process.env.NODE_ENV === 'production';

const {
    doubleCsrfProtection,
    generateCsrfToken,
    invalidCsrfTokenError
} = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET || process.env.SESSION_SECRET,
    getSessionIdentifier: () => '',
    cookieName: 'csrfToken',
    cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/'
    },
    getCsrfTokenFromRequest: (req) =>
        req.headers['csrf-token'] ||
        req.headers['x-csrf-token'] ||
        (req.body && req.body._csrf),
    errorConfig: {
        statusCode: 403,
        message: 'CSRF token inválido. Recarregue a página e tente novamente.',
        code: 'EBADCSRFTOKEN'
    }
});

module.exports = { doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError };
