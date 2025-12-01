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

## 🔄 ATUALIZAÇÕES DE SEGURANÇA (2025-12-01)

### ✅ Correções Implementadas

#### 1. ✅ Vulnerabilidade node-forge CORRIGIDA
**Status**: ✅ RESOLVIDO
**Data**: 2025-12-01

**Problema**: Dependência `node-forge` com vulnerabilidade HIGH (CVE GHSA-5gfm-wpxj-wjgq, CVSS 8.6)
- ASN.1 Unbounded Recursion
- Interpretation Conflict vulnerability

**Solução Aplicada**:
```bash
npm update node-forge  # Atualizado para versão >= 1.3.2
```

**Resultado**: ✅ Vulnerabilidade HIGH eliminada

---

#### 2. ✅ Vulnerabilidade express CORRIGIDA
**Status**: ✅ RESOLVIDO
**Data**: 2025-12-01

**Problema**: Dependência `express` <4.22.0 com vulnerabilidade LOW (GHSA-pj86-cfqh-vqx6)
- express improperly controls modification of query properties

**Solução Aplicada**:
```bash
npm audit fix  # express: 4.21.2 → 4.22.0
```

**Resultado**: ✅ `npm audit` agora reporta **0 vulnerabilidades**

---

#### 3. ✅ Biblioteca csurf Deprecada SUBSTITUÍDA
**Status**: ✅ RESOLVIDO
**Data**: 2025-12-01

**Problema**: Biblioteca `csurf` foi descontinuada em 2021 e não recebe mais atualizações de segurança.

**Solução Aplicada**:
```bash
npm uninstall csurf
npm install csrf-csrf
```

**Mudanças no Código**:
- `server.js:27` - Import atualizado para `csrf-csrf`
- `server.js:1778-1804` - Configuração migrada para `doubleCsrf`
- `server.js:787-800` - Endpoint `/api/csrf-token` atualizado

**Benefícios**:
- Biblioteca mantida ativamente
- Melhor proteção contra CSRF
- Double-submit cookie pattern
- Sem vulnerabilidades conhecidas

---

## ⚠️ Limitações Conhecidas

### 1. Webhook OndaPay sem Assinatura HMAC ⚠️ LIMITAÇÃO DA API
**Status**: ⚠️ LIMITAÇÃO EXTERNA (não é falha do código)
**Localização**: `server.js:1067` - endpoint `/ondapay-webhook`
**Documentação Completa**: Ver [`ONDAPAY_WEBHOOK_SECURITY.md`](./ONDAPAY_WEBHOOK_SECURITY.md)

**Problema**: A API OndaPay **NÃO fornece mecanismo de validação de assinatura HMAC** em webhooks, conforme confirmado pelo desenvolvedor.

**⚠️ Risco**: Sem validação de assinatura, o endpoint é teoricamente vulnerável a webhooks falsos.

**✅ Mitigações Implementadas**:
1. ✅ Rate limiting agressivo (30 webhooks/minuto)
2. ✅ Idempotência (previne processamento duplicado)
3. ✅ Validação robusta de dados de entrada
4. ✅ Logging detalhado para auditoria forense
5. ✅ Notificações push em tempo real para admin
6. ✅ Timeout de QR Code (30 minutos)

**🔴 Mitigação Recomendada (NÃO IMPLEMENTADA):**
- **Whitelist de IPs da OndaPay** (reduz risco em ~90%)
- Solicitar lista de IPs ao suporte da OndaPay
- Implementar middleware de validação de IP

**Nível de Risco**:
- Sem mitigações: 🔴 CRÍTICO (10/10)
- Com mitigações atuais: 🟡 MÉDIO (5/10)
- Com whitelist de IPs: 🟢 BAIXO (2/10)

**Ação Recomendada**:
1. Solicitar IPs da OndaPay ao suporte
2. Implementar whitelist conforme [`ONDAPAY_WEBHOOK_SECURITY.md`](./ONDAPAY_WEBHOOK_SECURITY.md)
3. Monitorar logs ativamente
4. Pressionar OndaPay para implementar assinatura HMAC

**Prioridade**: 🟡 MÉDIA - Implementar whitelist de IPs esta semana

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

### 2025-12-01 - Auditoria Sênior e Correções Críticas
- ✅ **Auditoria completa de segurança realizada** (ver `AUDIT_REPORT_SENIOR_2025.md`)
- ✅ **Vulnerabilidade node-forge corrigida** (HIGH → 0 vulnerabilities)
- ✅ **Vulnerabilidade express corrigida** (LOW → 0 vulnerabilities)
- ✅ **Biblioteca csurf deprecada substituída** por csrf-csrf
- ✅ **Migração para double-submit CSRF pattern**
- ✅ **Documentação webhook OndaPay** criada (ONDAPAY_WEBHOOK_SECURITY.md)
- ✅ **npm audit: 0 vulnerabilidades**

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
- [ ] Implementar whitelist de IPs para webhook OndaPay (ALTA PRIORIDADE)
- [ ] Migrar Firebase config do frontend para usar o endpoint do backend
- [ ] Adicionar logs estruturados (Winston)
- [ ] Implementar migrations do Sequelize
- [ ] Adicionar testes automatizados
- [ ] Refatorar server.js em arquitetura em camadas

---

## 📞 Contato

Para questões gerais de segurança ou sugestões, entre em contato:
- Email: cinepremium.sac@gmail.com

---

**Última atualização**: 01/12/2025
**Versão**: 2.1.0
