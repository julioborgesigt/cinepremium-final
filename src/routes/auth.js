'use strict';

const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const { loginLimiter } = require('../middlewares/rateLimiters');

const router = express.Router();

// Nota: applyCsrf é injetado via app.set para evitar dependência circular na inicialização
function getApplyCsrf(req) {
    return req.app.get('applyCsrf');
}

// GET /login — exibe a página de login
router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'login.html'));
});

// POST /auth — processa login com bcrypt e CSRF
router.post('/auth', loginLimiter, (req, res, next) => {
    const applyCsrf = getApplyCsrf(req);
    if (applyCsrf) {
        applyCsrf(req, res, next);
    } else {
        next();
    }
}, async (req, res) => {
    const { username, password } = req.body;
    console.log('[AUTH] Tentativa de login para usuário:', username);

    try {
        if (username !== process.env.ADMIN_USER) {
            console.log('[AUTH] Username incorreto');
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const passwordHash = process.env.ADMIN_PASS;
        const isPasswordValid = await bcrypt.compare(password, passwordHash);

        if (isPasswordValid) {
            req.session.regenerate((err) => {
                if (err) {
                    console.error('[AUTH] Erro ao regenerar sessão:', err);
                    return res.status(500).json({ error: 'Erro ao processar login' });
                }
                req.session.loggedin = true;
                req.session.save((saveErr) => {
                    if (saveErr) {
                        console.error('[AUTH] Erro ao salvar sessão:', saveErr);
                        return res.status(500).json({ error: 'Erro ao salvar sessão' });
                    }
                    console.log('[AUTH] ✅ Login bem-sucedido');
                    res.json({ success: true, redirect: '/admin' });
                });
            });
        } else {
            console.log('[AUTH] Senha incorreta');
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
    } catch (error) {
        console.error('[AUTH] Erro na autenticação:', error);
        return res.status(500).json({ error: 'Erro no servidor' });
    }
});

// GET /logout — destrói a sessão e redireciona para login
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('[LOGOUT] Erro ao destruir sessão:', err);
            return res.redirect('/admin');
        }
        res.clearCookie('sessionId');
        res.redirect('/login');
    });
});

module.exports = router;
