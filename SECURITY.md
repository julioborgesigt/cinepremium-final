# Política de Segurança - CinePremium

## 🔒 Visão Geral de Segurança

Este documento descreve as práticas de segurança implementadas no projeto CinePremium e orientações para manter a aplicação segura.

---

## ✅ Medidas de Segurança Implementadas

### 1. Proteção de Sessões
- **httpOnly cookies**: Previne acesso via JavaScript (proteção XSS)
- **secure cookies**: Transmissão apenas via HTTPS em produção
- **sameSite: strict**: Proteção contra CSRF
- **Expiração**: Sessões expiram após 8 horas de inatividade

### 2. Rate Limiting
- **Global**: 100 requisições por IP a cada 15 minutos
- **Login**: 5 tentativas de login por IP a cada 15 minutos
- **Geração de QR Code**: 3 tentativas por hora, 5 por mês (por telefone)

### 3. Headers de Segurança (Helmet.js)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Strict-Transport-Security (HSTS)

### 4. CORS Configurado
- Em produção: Apenas origens específicas permitidas
- Em desenvolvimento: Liberado para testes
- Credentials: true (permite cookies cross-origin autenticados)

### 5. Validações no Backend
Todas as entradas de usuário são validadas no servidor:
- CPF (validação completa com dígitos verificadores)
- E-mail (regex)
- Telefone (11 dígitos)
- Preço (positivo, não zero)
- Nome (mínimo 3 caracteres)
- Imagem (máximo 1MB)

### 6. Banco de Dados
- Credenciais em variáveis de ambiente
- Pool de conexões configurado
- Timezone correto (-03:00 BRT)
- Sync desabilitado em produção (usar migrations)

### 7. Gerenciamento de Secrets
- Todas as credenciais em `.env`
- `.env` no `.gitignore`
- `.env.example` fornecido para documentação
- Firebase Admin SDK em Base64

---

## ⚠️ Vulnerabilidades Conhecidas (TODO)

### 1. Webhook sem Verificação de Assinatura ⚠️ CRÍTICO
**Status**: Não implementado
**Localização**: `server.js:457` - endpoint `/ondapay-webhook`

**Problema**: O webhook da OndaPay não verifica a assinatura HMAC, permitindo que atacantes enviem requisições falsas simulando pagamentos.

**Solução Recomendada**:
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}

// No webhook:
const signature = req.headers['x-ondapay-signature'];
if (!verifyWebhookSignature(req.body, signature, process.env.ONDAPAY_WEBHOOK_SECRET)) {
  return res.status(401).send('Assinatura inválida');
}
```

**Prioridade**: 🔴 CRÍTICA - Implementar antes de produção

---

### 2. Credenciais Firebase no Frontend
**Status**: Parcialmente resolvido
**Localização**: `public/admin.html:509`, `public/firebase-messaging-sw.js:9`

**Problema**: As configurações do Firebase (API Key, Project ID, etc.) estão hardcoded no frontend.

**Solução Implementada**: Endpoint `/api/firebase-config` criado
**Próximo Passo**: Atualizar frontend para buscar config do backend

**Prioridade**: 🟡 MÉDIA - Melhorar antes de produção

---

### 3. Senha em Texto Plano no .env
**Status**: Não implementado
**Localização**: `.env` - `ADMIN_PASS`

**Problema**: Senha armazenada sem hash. Se o .env for comprometido, a senha fica exposta.

**Solução Recomendada**:
```bash
npm install bcrypt
```

```javascript
const bcrypt = require('bcrypt');

// Gerar hash (fazer uma vez, offline):
const hash = await bcrypt.hash('sua_senha', 10);
// Armazenar hash no .env

// No login:
const match = await bcrypt.compare(password, process.env.ADMIN_PASS_HASH);
```

**Prioridade**: 🟡 MÉDIA

---

## 🛡️ Melhores Práticas de Configuração

### Variáveis de Ambiente Obrigatórias

#### Em Produção:
```bash
NODE_ENV=production
SESSION_SECRET=<string-aleatoria-forte-32-caracteres>
ADMIN_USER=<usuario-admin>
ADMIN_PASS=<senha-forte>
DB_NAME=<nome-banco>
DB_USER=<usuario-banco>
DB_PASS=<senha-banco>
DB_HOST=<host-banco>
ONDAPAY_CLIENT_ID=<id-cliente>
ONDAPAY_CLIENT_SECRET=<secret-cliente>
ONDAPAY_WEBHOOK_SECRET=<webhook-secret>  # IMPORTANTE!
WEBHOOK_URL=<sua-url-publica>/ondapay-webhook
FIREBASE_CREDENTIALS_BASE64=<credentials-base64>
FIREBASE_API_KEY=<sua-api-key>
FIREBASE_PROJECT_ID=<seu-projeto>
# ... demais configs Firebase
ALLOWED_ORIGINS=https://seu-dominio.com,https://www.seu-dominio.com
```

#### Gerar SESSION_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🚨 Relatando Vulnerabilidades

Se você descobrir uma vulnerabilidade de segurança, **NÃO** abra uma issue pública.

**Contato de Segurança**:
- Email: cinepremium.sac@gmail.com
- Assunto: [SEGURANÇA] Vulnerabilidade no CinePremium

Por favor, inclua:
- Descrição detalhada da vulnerabilidade
- Passos para reproduzir
- Impacto potencial
- Sugestão de correção (se tiver)

Responderemos em até 48 horas.

---

## 📋 Checklist de Segurança para Deploy

Antes de fazer deploy em produção, verifique:

- [ ] Todas as variáveis de ambiente estão configuradas
- [ ] `NODE_ENV=production` está definido
- [ ] SESSION_SECRET é uma string aleatória forte (min. 32 caracteres)
- [ ] ADMIN_PASS é uma senha forte e única
- [ ] Credenciais do banco de dados são seguras
- [ ] ONDAPAY_WEBHOOK_SECRET está configurado
- [ ] Verificação de assinatura do webhook está implementada ⚠️
- [ ] ALLOWED_ORIGINS contém apenas seus domínios
- [ ] Firebase config foi movida para o backend ⚠️
- [ ] Arquivo .env NÃO está no repositório
- [ ] HTTPS está habilitado
- [ ] Certificado SSL é válido
- [ ] Logs de produção não expõem informações sensíveis
- [ ] Backup do banco de dados está configurado
- [ ] Monitoramento de erros está ativo (Sentry, etc.)

---

## 📚 Recursos Adicionais

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Node.js Security Checklist](https://blog.risingstack.com/node-js-security-checklist/)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)

---

## 🔄 Histórico de Atualizações

### 2025-01-06
- ✅ Implementado helmet.js
- ✅ Implementado rate limiting (global e login)
- ✅ Configuração segura de sessões (httpOnly, secure, sameSite)
- ✅ Validações completas no backend
- ✅ CORS configurado
- ✅ Endpoint `/api/firebase-config` criado
- ✅ Removida rota `/debug-env`
- ✅ Criado `.env.example`
- ✅ Documentação de segurança criada

### Próximas Melhorias Planejadas
- [ ] Implementar verificação de assinatura no webhook
- [ ] Migrar Firebase config do frontend para usar o endpoint do backend
- [ ] Implementar hash de senha com bcrypt
- [ ] Adicionar logs estruturados (Winston)
- [ ] Implementar migrations do Sequelize
- [ ] Adicionar testes automatizados

---

## 📞 Contato

Para questões gerais de segurança ou sugestões, entre em contato:
- Email: cinepremium.sac@gmail.com

---

**Última atualização**: 06/01/2025
**Versão**: 2.0.0
