# GUIA DE CORREÇÕES RÁPIDAS - VULNERABILIDADES CRÍTICAS

**Prazo:** 1-2 dias
**Prioridade:** MÁXIMA
**Status:** ⚠️ BLOQUEADOR DE PRODUÇÃO

---

## 🚨 1. IMPLEMENTAR VERIFICAÇÃO HMAC NO WEBHOOK ONDAPAY

**Severidade:** CRÍTICA
**Esforço:** 2-4 horas
**Arquivo:** `server.js` linha 786

### Código Atual (VULNERÁVEL)
```javascript
app.post('/ondapay-webhook', async (req, res) => {
  // SEM VERIFICAÇÃO DE ASSINATURA!
  const { id } = req.body;
  // Processa diretamente
});
```

### Correção
```javascript
const crypto = require('crypto'); // Adicionar no topo do arquivo

app.post('/ondapay-webhook', async (req, res) => {
  try {
    // 1. Obter assinatura do header
    const signature = req.headers['x-ondapay-signature'];

    // 2. Validar que secret está configurado
    const secret = process.env.ONDAPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('ERRO: ONDAPAY_WEBHOOK_SECRET não configurado');
      return res.status(500).json({ error: 'Server misconfigured' });
    }

    // 3. Verificar se assinatura foi enviada
    if (!signature) {
      console.warn('Webhook sem assinatura recebido');
      return res.status(401).json({ error: 'Missing signature' });
    }

    // 4. Calcular HMAC esperado
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSignature = hmac.update(JSON.stringify(req.body)).digest('hex');

    // 5. Comparar assinaturas (timing-safe)
    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )) {
      console.warn('Webhook com assinatura inválida recebido', {
        ip: req.ip,
        body: req.body
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 6. Assinatura válida, processar webhook
    const { id } = req.body;
    // ... resto do código

  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});
```

### Adicionar ao .env
```bash
# Obter este valor no painel da OndaPay
ONDAPAY_WEBHOOK_SECRET=seu_webhook_secret_aqui
```

### Testar
```bash
# Simular webhook válido
curl -X POST http://localhost:3000/ondapay-webhook \
  -H "Content-Type: application/json" \
  -H "x-ondapay-signature: <hmac_calculado>" \
  -d '{"id": "123", "status": "approved"}'
```

---

## 🚨 2. REMOVER SUPORTE A SENHAS EM TEXTO PLANO

**Severidade:** CRÍTICA
**Esforço:** 1 hora
**Arquivo:** `server.js` linhas 346-365

### Código Atual (VULNERÁVEL)
```javascript
if (passwordHash && (passwordHash.startsWith('$2b$') || passwordHash.startsWith('$2a$'))) {
  isPasswordValid = await bcrypt.compare(password, passwordHash);
} else {
  // VULNERÁVEL: aceita texto plano
  console.warn('⚠️ AVISO: Senha do admin está em texto plano.');
  isPasswordValid = (password === passwordHash);
}
```

### Correção
```javascript
// Validar que senha está em formato bcrypt
if (!passwordHash || (!passwordHash.startsWith('$2b$') && !passwordHash.startsWith('$2a$'))) {
  console.error('ERRO CRÍTICO: ADMIN_PASS deve ser hash bcrypt');
  console.error('Execute: npm run hash-password sua_senha_aqui');
  process.exit(1); // Falha na inicialização
}

// Comparar usando bcrypt
isPasswordValid = await bcrypt.compare(password, passwordHash);
```

### Gerar Hash da Senha
```bash
# Usar o script do package.json
npm run hash-password minhasenhaforte123

# Ou manualmente
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('minhasenhaforte123', 10).then(hash => console.log(hash));"
```

### Atualizar .env
```bash
# ANTES (INSEGURO)
ADMIN_PASS=minhasenha123

# DEPOIS (SEGURO)
ADMIN_PASS=$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEF
```

---

## 🚨 3. IMPLEMENTAR CSP ADEQUADO

**Severidade:** CRÍTICA
**Esforço:** 2-3 horas
**Arquivo:** `server.js` linhas 51-54

### Código Atual (VULNERÁVEL)
```javascript
app.use(helmet({
  contentSecurityPolicy: false, // DESABILITADO!
  crossOriginEmbedderPolicy: false
}));
```

### Correção
```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://www.gstatic.com",
        "https://apis.google.com"
      ],
      connectSrc: [
        "'self'",
        "https://fcm.googleapis.com",
        "https://fcmregistrations.googleapis.com",
        "https://ondapay.app.br"
      ],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Temporário - migrar para nonces
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false // Necessário para Firebase
}));
```

### Testar
```bash
# Verificar headers CSP
curl -I http://localhost:3000

# Usar ferramenta online
# https://securityheaders.com
```

---

## 🚨 4. VALIDAR SESSION_SECRET OBRIGATÓRIO

**Severidade:** CRÍTICA
**Esforço:** 30 minutos
**Arquivo:** `server.js` linha 1046

### Código Atual (VULNERÁVEL)
```javascript
secret: process.env.SESSION_SECRET || 'fallback-secret-change-this'
```

### Correção
```javascript
// Adicionar validação no início do arquivo (após imports)
if (!process.env.SESSION_SECRET) {
  console.error('ERRO CRÍTICO: SESSION_SECRET não configurado no .env');
  console.error('Gere um secret forte com:');
  console.error('node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// Usar na configuração de sessão
secret: process.env.SESSION_SECRET // Sem fallback
```

### Gerar SESSION_SECRET
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Adicionar ao .env
```bash
SESSION_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

---

## 🚨 5. IMPLEMENTAR CSRF TOKENS

**Severidade:** CRÍTICA
**Esforço:** 4-6 horas
**Arquivos:** `server.js` + todos os HTML

### Instalar Dependência
```bash
npm install csurf
```

### Backend - Configurar CSRF
```javascript
// No topo do server.js
const csrf = require('csurf');

// Após configuração de sessão
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
});

// Endpoint para obter token
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Aplicar a rotas que modificam dados
app.post('/auth', csrfProtection, async (req, res) => { /* ... */ });
app.post('/gerarqrcode', csrfProtection, async (req, res) => { /* ... */ });
app.post('/api/products', requireLogin, csrfProtection, async (req, res) => { /* ... */ });
app.put('/api/products/reorder', requireLogin, csrfProtection, async (req, res) => { /* ... */ });
app.delete('/api/products/:id', requireLogin, csrfProtection, async (req, res) => { /* ... */ });

// Converter logout para POST
app.post('/logout', csrfProtection, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao fazer logout' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});
```

### Frontend - Usar CSRF Token

**1. Criar utilitário para obter token**
```javascript
// Adicionar em todos os HTML
let csrfToken = null;

async function getCsrfToken() {
  if (!csrfToken) {
    const response = await fetch('/api/csrf-token');
    const data = await response.json();
    csrfToken = data.csrfToken;
  }
  return csrfToken;
}
```

**2. Incluir token em requisições**
```javascript
// Exemplo: index.html - gerarqrcode
document.getElementById('generateBtn').addEventListener('click', async function() {
  const token = await getCsrfToken();

  const response = await fetch('/gerarqrcode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CSRF-Token': token // ADICIONAR
    },
    body: JSON.stringify({ /* ... */ })
  });

  // Se receber 403 (CSRF inválido), recarregar token
  if (response.status === 403) {
    csrfToken = null;
    // Tentar novamente...
  }
});
```

**3. Atualizar logout**
```javascript
// admin.html - trocar link por botão
<button onclick="logout()" style="display: block; text-align: center; margin-bottom: 20px;">
  Sair!
</button>

<script>
async function logout() {
  const token = await getCsrfToken();
  const response = await fetch('/logout', {
    method: 'POST',
    headers: {
      'CSRF-Token': token
    }
  });

  if (response.ok) {
    window.location.href = '/login';
  }
}
</script>
```

---

## 🚨 6. SANITIZAR INPUTS (PREVENIR XSS)

**Severidade:** CRÍTICA
**Esforço:** 3-4 horas
**Arquivos:** `server.js`

### Instalar Dependências
```bash
npm install xss validator
```

### Implementar Sanitização
```javascript
// No topo do server.js
const xss = require('xss');
const validator = require('validator');

// Criar função utilitária
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;

  // Remover HTML/scripts maliciosos
  return xss(validator.trim(input), {
    whiteList: {}, // Não permite nenhuma tag HTML
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style']
  });
}

// Aplicar em todos os endpoints que recebem input
app.post('/api/products', requireLogin, async (req, res) => {
  try {
    const { title, price, image, description } = req.body;

    // SANITIZAR inputs
    const sanitizedTitle = sanitizeInput(title);
    const sanitizedDescription = description ? sanitizeInput(description) : '';

    // Validar que sanitização não removeu tudo
    if (!sanitizedTitle || sanitizedTitle.length < 3) {
      return res.status(400).json({
        error: 'Título inválido ou contém caracteres não permitidos'
      });
    }

    // Validar tamanho de imagem
    if (!image || image.length > 1500000) { // ~1MB em base64
      return res.status(400).json({ error: 'Imagem inválida ou muito grande' });
    }

    // Validar preço
    const priceInt = parseInt(price);
    if (isNaN(priceInt) || priceInt <= 0 || priceInt > 1000000) {
      return res.status(400).json({ error: 'Preço inválido' });
    }

    // Criar produto com dados sanitizados
    const product = await Product.create({
      title: sanitizedTitle,
      price: priceInt,
      image: image,
      description: sanitizedDescription
    });

    res.json(product);
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro ao criar produto.' });
  }
});

// Aplicar também em /gerarqrcode
app.post('/gerarqrcode', async (req, res) => {
  const { value, nome, telefone, cpf, email } = req.body;

  // SANITIZAR
  const sanitizedNome = sanitizeInput(nome);
  const sanitizedEmail = validator.normalizeEmail(email);

  // Validar
  if (!sanitizedNome || sanitizedNome.length < 3) {
    return res.status(400).json({ error: 'Nome inválido' });
  }

  if (!validator.isEmail(sanitizedEmail)) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  // ... resto do código usando sanitizedNome, sanitizedEmail
});
```

---

## 🚨 7. CORRIGIR SQL INJECTION NO LIKE

**Severidade:** CRÍTICA
**Esforço:** 30 minutos
**Arquivo:** `server.js` linha 976

### Código Atual (VULNERÁVEL)
```javascript
if (nome) {
  where.nome = { [Op.like]: `%${nome}%` }; // VULNERÁVEL a wildcard injection
}
```

### Correção
```javascript
if (nome) {
  // Sanitizar caracteres especiais do LIKE (% e _)
  const sanitizedNome = nome.replace(/[%_]/g, '\\$&');
  where.nome = { [Op.like]: `%${sanitizedNome}%` };
}
```

---

## ✅ CHECKLIST DE IMPLEMENTAÇÃO

### Antes de Começar
- [ ] Fazer backup do código atual
- [ ] Criar branch de desenvolvimento
- [ ] Configurar ambiente de testes

### Implementação
- [ ] 1. Webhook HMAC verification
- [ ] 2. Remover senhas em texto plano
- [ ] 3. CSP configurado
- [ ] 4. SESSION_SECRET validado
- [ ] 5. CSRF tokens implementados
- [ ] 6. XSS sanitization
- [ ] 7. SQL injection corrigido

### Testes
- [ ] Testar cada correção individualmente
- [ ] Testar fluxo completo de compra
- [ ] Testar painel administrativo
- [ ] Testar webhook com assinatura válida/inválida
- [ ] Testar CSRF tokens em todas as rotas
- [ ] Verificar logs (sem dados sensíveis)

### Deploy
- [ ] Atualizar .env em produção com novos valores
- [ ] Gerar SESSION_SECRET forte
- [ ] Gerar hash bcrypt da senha admin
- [ ] Configurar ONDAPAY_WEBHOOK_SECRET
- [ ] Testar em staging primeiro
- [ ] Deploy em produção
- [ ] Monitorar logs por 24h

### Validação Pós-Deploy
- [ ] Verificar headers CSP: https://securityheaders.com
- [ ] Testar webhook real da OndaPay
- [ ] Verificar que senhas antigas não funcionam mais
- [ ] Confirmar que CSRF protege endpoints
- [ ] npm audit (deve estar clean)

---

## 🆘 TROUBLESHOOTING

### Problema: CSRF token inválido
**Solução:** Verificar que cookie de sessão está sendo enviado (credentials: 'include' no fetch)

### Problema: Webhook rejeitado
**Solução:** Verificar formato da assinatura com OndaPay (hex vs base64)

### Problema: CSP bloqueando Firebase
**Solução:** Adicionar domínios Firebase ao CSP (ver correção #3)

### Problema: Sessão não persiste
**Solução:** Verificar Redis está funcionando, SESSION_SECRET configurado

---

## 📞 SUPORTE

Se encontrar problemas durante a implementação:

1. Verificar logs do servidor
2. Verificar console do browser (erros CSP/CSRF)
3. Testar endpoints com curl primeiro
4. Revisar este guia passo a passo

---

**IMPORTANTE:** Estas correções são CRÍTICAS e devem ser implementadas ANTES de qualquer deploy em produção!

**Próximo passo:** Após implementar estas 7 correções, revisar o COMPREHENSIVE-AUDIT-REPORT.md para planejar as melhorias URGENTES e IMPORTANTES.
