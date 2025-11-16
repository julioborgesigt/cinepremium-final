// Exemplo de autenticação com usuários no banco de dados
// Este é um EXEMPLO - não está integrado ao sistema atual

const bcrypt = require('bcrypt');

// Rota de autenticação com banco de dados
app.post('/auth-db', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1. Buscar usuário no banco
    const user = await User.findOne({
      where: {
        username: username.toLowerCase().trim()
      }
    });

    // 2. Verificar se usuário existe
    if (!user) {
      console.log('[AUTH] Usuário não encontrado:', username);
      return res.redirect('/login?error=1');
    }

    // 3. Verificar se está ativo
    if (!user.isActive) {
      console.log('[AUTH] Usuário inativo:', username);
      return res.redirect('/login?error=inactive');
    }

    // 4. Verificar se está bloqueado (muitas tentativas)
    if (user.isLocked()) {
      console.log('[AUTH] Usuário bloqueado temporariamente:', username);
      const minutesLeft = Math.ceil((user.lockedUntil - new Date()) / 60000);
      return res.redirect(`/login?error=locked&minutes=${minutesLeft}`);
    }

    // 5. Validar senha
    const isPasswordValid = await user.validatePassword(password);

    if (!isPasswordValid) {
      console.log('[AUTH] Senha incorreta para:', username);

      // Incrementar tentativas de login
      await user.incrementLoginAttempts();

      return res.redirect('/login?error=1');
    }

    // 6. Login bem-sucedido
    console.log('[AUTH] ✅ Login bem-sucedido:', username);

    // Resetar tentativas de login
    await user.resetLoginAttempts();

    // Criar log de auditoria (opcional)
    await LoginLog.create({
      userId: user.id,
      username: user.username,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true
    });

    // Regenerar sessão
    req.session.regenerate((err) => {
      if (err) {
        console.error('[AUTH] Erro ao regenerar sessão:', err);
        return res.redirect('/login?error=1');
      }

      // Armazenar dados do usuário na sessão
      req.session.loggedin = true;
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role; // admin, manager, viewer

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[AUTH] Erro ao salvar sessão:', saveErr);
          return res.redirect('/login?error=1');
        }

        res.redirect('/admin');
      });
    });

  } catch (error) {
    console.error('[AUTH] Erro na autenticação:', error);
    res.redirect('/login?error=1');
  }
});

// Middleware com controle de permissões por role
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.session.loggedin) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Não autorizado' });
      }
      return res.redirect('/login');
    }

    // Verificar se o role do usuário está permitido
    if (!allowedRoles.includes(req.session.role)) {
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'Sem permissão para esta ação' });
      }
      return res.redirect('/admin?error=forbidden');
    }

    next();
  };
}

// Exemplos de uso:
// Somente admin pode criar produtos
app.post('/api/products', requireRole(['admin']), async (req, res) => {
  // ...
});

// Admin e manager podem ver histórico
app.get('/api/purchase-history', requireRole(['admin', 'manager']), async (req, res) => {
  // ...
});

// Qualquer usuário logado pode ver produtos
app.get('/api/products', requireRole(['admin', 'manager', 'viewer']), async (req, res) => {
  // ...
});
