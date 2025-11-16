# MUDANÇAS IMPLEMENTADAS NAS CORREÇÕES CRÍTICAS

## ✅ COMPLETADO

### 1. Imports e Dependências
- ✅ Adicionados: crypto, csrf, xss, validator
- ✅ Instalados: csurf, xss, validator

### 2. Validações de Environment Variables (início do arquivo)
- ✅ SESSION_SECRET obrigatório (exit se não configurado)
- ✅ ADMIN_PASS deve ser bcrypt (exit se texto plano)
- ✅ ONDAPAY_CLIENT_ID/SECRET obrigatórios
- ✅ ONDAPAY_WEBHOOK_SECRET obrigatório

### 3. Funções Utilitárias de Segurança
- ✅ sanitizeInput() - Remove XSS de inputs
- ✅ applyCsrf() - Wrapper condicional para CSRF

### 4. CORS Seguro
- ✅ Lista whitelist específica mesmo em dev
- ✅ Removido `origin: true` perigoso

### 5. CSP Configurado
- ✅ Content Security Policy ativado
- ✅ Diretivas para Firebase, OndaPay, etc

### 6. Variáveis Globais
- ✅ csrfProtection adicionada

### 7. Inicialização CSRF
- ✅ csrfProtection inicializado em startServer()
- ✅ Endpoint /api/csrf-token criado

### 8. Rota /auth
- ✅ CSRF adicionado (applyCsrf)
- ✅ Código de senha texto plano removido
- ✅ Apenas bcrypt.compare()
- ✅ SESSION_SECRET sem fallback

## 🔄 PENDENTE

### 9. Rotas que precisam de CSRF + Sanitização

#### /gerarqrcode (linha ~720)
```javascript
// ANTES:
app.post('/gerarqrcode', async (req, res) => {
  const { value, nome, telefone, cpf, email } = req.body;

// DEPOIS:
app.post('/gerarqrcode', applyCsrf, async (req, res) => {
  const { value, telefone, cpf, email } = req.body;
  const nome = sanitizeInput(req.body.nome);

  // Validar dados sanitizados
  if (!nome || nome.length < 3) {
    return res.status(400).json({ error: 'Nome inválido' });
  }

  const sanitizedEmail = validator.normalizeEmail(email);
  if (!validator.isEmail(sanitizedEmail)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
```

#### /api/products POST (linha ~900)
```javascript
// ANTES:
app.post('/api/products', requireLogin, async (req, res) => {
  const { title, price, image, description } = req.body;

// DEPOIS:
app.post('/api/products', requireLogin, applyCsrf, async (req, res) => {
  const { price, image } = req.body;
  const title = sanitizeInput(req.body.title);
  const description = req.body.description ? sanitizeInput(req.body.description) : '';

  // Validar
  if (!title || title.length < 3) {
    return res.status(400).json({ error: 'Título inválido' });
  }

  const priceInt = parseInt(price);
  if (isNaN(priceInt) || priceInt <= 0 || priceInt > 1000000) {
    return res.status(400).json({ error: 'Preço inválido' });
  }

  if (!image || image.length > 1500000) {
    return res.status(400).json({ error: 'Imagem inválida ou muito grande' });
  }

  await Product.create({
    title,
    price: priceInt,
    image,
    description
  });
```

#### /api/products/reorder PUT (linha ~960)
```javascript
// ANTES:
app.put('/api/products/reorder', requireLogin, async (req, res) => {

// DEPOIS:
app.put('/api/products/reorder', requireLogin, applyCsrf, async (req, res) => {
```

#### /api/products/:id DELETE (linha ~990)
```javascript
// ANTES:
app.delete('/api/products/:id', requireLogin, async (req, res) => {

// DEPOIS:
app.delete('/api/products/:id', requireLogin, applyCsrf, async (req, res) => {
  const { id } = req.params;
  const productId = parseInt(id);

  if (isNaN(productId) || productId <= 0) {
    return res.status(400).json({ error: 'ID inválido' });
  }
```

#### /check-local-status POST (linha ~950)
```javascript
// ANTES:
app.post('/check-local-status', async (req, res) => {

// DEPOIS:
app.post('/check-local-status', applyCsrf, async (req, res) => {
```

#### /logout - Converter para POST (linha ~500)
```javascript
// ANTES:
app.get('/logout', (req, res) => {

// DEPOIS:
app.post('/logout', applyCsrf, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao fazer logout' });
    }
    res.clearCookie('sessionId');
    res.json({ success: true });
  });
});
```

### 10. CORREÇÃO CRÍTICA #7: SQL Injection no LIKE (linha ~1020)
```javascript
// ANTES:
if (nome) {
  where.nome = { [Op.like]: `%${nome}%` };
}

// DEPOIS:
if (nome) {
  const sanitizedNome = nome.replace(/[%_]/g, '\\$&');
  where.nome = { [Op.like]: `%${sanitizedNome}%` };
}
```

### 11. CORREÇÃO CRÍTICA #1: Webhook HMAC (linha ~850)
```javascript
// ANTES:
app.post('/ondapay-webhook', async (req, res) => {
  const { id } = req.body;

// DEPOIS:
app.post('/ondapay-webhook', async (req, res) => {
  try {
    // 1. Obter assinatura do header
    const signature = req.headers['x-ondapay-signature'];
    const secret = process.env.ONDAPAY_WEBHOOK_SECRET;

    // 2. Validar assinatura
    if (!signature) {
      console.warn('[Webhook] Assinatura ausente', { ip: req.ip });
      return res.status(401).json({ error: 'Missing signature' });
    }

    // 3. Calcular HMAC
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSignature = hmac.update(JSON.stringify(req.body)).digest('hex');

    // 4. Comparar (timing-safe)
    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )) {
      console.warn('[Webhook] Assinatura inválida', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 5. Processar webhook
    const { id } = req.body;
    // ... resto do código
  } catch (error) {
    console.error('[Webhook] Erro:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
});
```

### 12. Remover Logs de Dados Sensíveis
Buscar e remover/mascarar:
- ❌ `console.log('[AUTH] Session ID:', req.sessionID);`
- ❌ `console.log('[PUSH LOG] Tokens:', tokens);`
- ❌ `console.log('Novo dispositivo registrado:', device.token);`

Substituir por logs mascarados ou condicionais apenas em dev.

### 13. Rate Limiting Específico
```javascript
// Adicionar antes do webhook
const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 50,
  message: 'Muitas requisições ao webhook'
});

app.post('/ondapay-webhook', webhookLimiter, async (req, res) => {

// Adicionar antes do check-local-status
const checkStatusLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: 'Muitas verificações de status'
});

app.post('/check-local-status', checkStatusLimiter, applyCsrf, async (req, res) => {
```

## 📄 PRÓXIMOS ARQUIVOS

Após completar server.js, precisamos atualizar:

### .env.example
Adicionar:
```bash
# CRÍTICO: Secret para validação de webhooks OndaPay (obrigatório em produção)
ONDAPAY_WEBHOOK_SECRET=seu_webhook_secret_aqui
```

### Frontend - Adicionar CSRF em fetch()
Em index.html, login.html, admin.html:
```javascript
// Adicionar função utilitária
let csrfToken = null;

async function getCsrfToken() {
  if (!csrfToken) {
    const response = await fetch('/api/csrf-token');
    const data = await response.json();
    csrfToken = data.csrfToken;
  }
  return csrfToken;
}

// Usar em todas as requisições POST/PUT/DELETE
const token = await getCsrfToken();
fetch('/rota', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'CSRF-Token': token
  },
  body: JSON.stringify({...})
});

// Se receber 403, recarregar token
if (response.status === 403) {
  csrfToken = null;
  // Tentar novamente
}
```

## 🎯 ORDEM DE IMPLEMENTAÇÃO

1. ✅ Validações environment variables
2. ✅ CORS seguro
3. ✅ CSP
4. ✅ Funções utilitárias (sanitizeInput, applyCsrf)
5. ✅ CSRF config e endpoint /api/csrf-token
6. ✅ Rota /auth (CSRF + bcrypt)
7. 🔄 Aplicar CSRF + sanitização em todas as rotas POST/PUT/DELETE
8. 🔄 Webhook HMAC
9. 🔄 SQL Injection LIKE
10. 🔄 Remover logs sensíveis
11. 🔄 Rate limiting específico
12. 🔄 Atualizar .env.example
13. 🔄 Atualizar frontend HTML
14. 🔄 Testar
15. 🔄 Commit
