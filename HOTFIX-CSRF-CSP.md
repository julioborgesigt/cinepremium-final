# HOTFIX: Ajustes CSRF e CSP

**Data:** 16 de Novembro de 2025
**Tipo:** Hotfix de compatibilidade
**Branch:** claude/code-audit-review-014VqpuJLMpct4b5Jj3LWKtK

---

## 🐛 PROBLEMAS IDENTIFICADOS

Após implementação das 7 correções críticas, foram identificados 2 problemas de compatibilidade com o frontend existente:

### 1. CSP Bloqueando Scripts Inline
**Erro:**
```
Loading the script violates the following Content Security Policy directive:
"script-src 'self' https://www.gstatic.com https://apis.google.com"
```

**Causa:** CSP configurado sem `'unsafe-inline'`, bloqueando todos os scripts inline nos arquivos HTML.

**Impacto:** Páginas HTML não funcionavam corretamente.

### 2. CSRF Bloqueando Login e Operações
**Erro:**
```
ForbiddenError: invalid csrf token
    at csrf (node_modules\csurf\index.js:112:19)
    at applyCsrf (server.js:89:5)
```

**Causa:** Frontend não está preparado para enviar CSRF tokens, mas rotas já estavam protegidas com `applyCsrf`.

**Impacto:** Login impossível, todas as operações bloqueadas.

---

## ✅ CORREÇÕES APLICADAS

### 1. CSP: Adicionado 'unsafe-inline' Temporariamente

**Arquivo:** `server.js` linha 126
**Mudança:**
```javascript
// ANTES (bloqueava scripts inline)
scriptSrc: [
  "'self'",
  "https://www.gstatic.com",
  "https://apis.google.com"
],

// DEPOIS (permite scripts inline temporariamente)
scriptSrc: [
  "'self'",
  "'unsafe-inline'", // TODO: Remover após migrar scripts inline para arquivos externos
  "https://www.gstatic.com",
  "https://apis.google.com"
],
```

**Justificativa:** Os arquivos HTML (index.html, login.html, admin.html) têm todo JavaScript inline. Até migrar para arquivos `.js` externos, precisamos permitir `'unsafe-inline'`.

**TODO:** Migrar scripts para arquivos externos e remover `'unsafe-inline'`.

---

### 2. CSRF: Removido Temporariamente das Rotas

**Mudança:** Removido `applyCsrf` de todas as rotas até frontend ser atualizado.

**Rotas Afetadas:**

| Rota | Antes | Depois | Linha |
|------|-------|--------|-------|
| `POST /auth` | ✅ applyCsrf | ❌ Removido | 423 |
| `POST /gerarqrcode` | ✅ applyCsrf | ❌ Removido | 728 |
| `POST /check-local-status` | ✅ applyCsrf | ❌ Removido | 962 |
| `POST /api/products` | ✅ applyCsrf | ❌ Removido | 998 |
| `PUT /api/products/reorder` | ✅ applyCsrf | ❌ Removido | 1037 |
| `DELETE /api/products/:id` | ✅ applyCsrf | ❌ Removido | 1055 |

**Justificativa:** Frontend não implementa CSRF tokens ainda. Aplicar CSRF agora quebraria todo o sistema.

**Infraestrutura Mantida:**
- ✅ Middleware `csrfProtection` configurado
- ✅ Função wrapper `applyCsrf()` disponível
- ✅ Endpoint `GET /api/csrf-token` funcional
- ✅ TODOs adicionados em todas as rotas

**TODO:** Implementar CSRF tokens no frontend conforme documentado em `CRITICAL-FIXES-IMPLEMENTED.md`.

---

## 📊 STATUS DAS CORREÇÕES CRÍTICAS

| # | Correção | Status Backend | Status Frontend | Bloqueador? |
|---|----------|----------------|-----------------|-------------|
| 1 | Webhook HMAC | ✅ Implementado | N/A | ❌ Não |
| 2 | Senha bcrypt | ✅ Implementado | N/A | ❌ Não |
| 3 | CSP | ⚠️ Com unsafe-inline | ⚠️ Scripts inline | ⚠️ Temporário |
| 4 | SESSION_SECRET | ✅ Implementado | N/A | ❌ Não |
| 5 | CSRF | ⚠️ Desabilitado | ❌ Não implementado | ⚠️ Temporário |
| 6 | Sanitização XSS | ✅ Implementado | N/A | ❌ Não |
| 7 | SQL Injection | ✅ Implementado | N/A | ❌ Não |

**Legenda:**
- ✅ Completamente implementado
- ⚠️ Parcialmente implementado (temporário)
- ❌ Não implementado

---

## 🎯 PRÓXIMOS PASSOS

### 1. Frontend - Implementar CSRF Tokens (PRIORITÁRIO)

**Arquivos a modificar:**
- `public/index.html`
- `public/login.html`
- `public/admin.html`

**Implementação:**

```javascript
// 1. Adicionar função utilitária em todos os HTMLs
let csrfToken = null;

async function getCsrfToken() {
  if (!csrfToken) {
    const response = await fetch('/api/csrf-token');
    const data = await response.json();
    csrfToken = data.csrfToken;
  }
  return csrfToken;
}

// 2. Usar em todas as requisições POST/PUT/DELETE
async function makeSecureRequest(url, options = {}) {
  const token = await getCsrfToken();

  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      'CSRF-Token': token,
      ...options.headers
    }
  };

  const response = await fetch(url, { ...options, ...defaultOptions });

  // Se CSRF inválido, recarregar token e tentar novamente
  if (response.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    defaultOptions.headers['CSRF-Token'] = newToken;
    return fetch(url, { ...options, ...defaultOptions });
  }

  return response;
}

// 3. Substituir todas as chamadas fetch
// ANTES:
fetch('/gerarqrcode', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({...})
});

// DEPOIS:
makeSecureRequest('/gerarqrcode', {
  method: 'POST',
  body: JSON.stringify({...})
});
```

### 2. Frontend - Migrar Scripts Inline para Arquivos Externos (PRIORITÁRIO)

**Objetivo:** Remover `'unsafe-inline'` do CSP

**Passos:**
1. Criar arquivos:
   - `public/js/index.js` (extrair de index.html)
   - `public/js/login.js` (extrair de login.html)
   - `public/js/admin.js` (extrair de admin.html)
   - `public/js/common.js` (funções compartilhadas)

2. Referenciar nos HTMLs:
```html
<script src="/js/common.js"></script>
<script src="/js/index.js"></script>
```

3. Remover `'unsafe-inline'` do CSP

### 3. Backend - Reativar CSRF

**Após frontend implementar tokens:**

Descomentar `applyCsrf` nas rotas:
```javascript
// Remover TODO e adicionar applyCsrf
app.post('/auth', loginLimiter, applyCsrf, async (req, res) => {
app.post('/gerarqrcode', applyCsrf, async (req, res) => {
// ... etc
```

---

## ⚠️ AVISOS IMPORTANTES

### Segurança Reduzida Temporariamente

Com CSRF desabilitado, o sistema está temporariamente vulnerável a:
- ✗ CSRF attacks (Cross-Site Request Forgery)
- ✗ Ações não autorizadas via requests forjados

**IMPORTANTE:** Implemente CSRF no frontend **o mais rápido possível**.

### CSP Enfraquecido Temporariamente

Com `'unsafe-inline'`, o CSP não bloqueia:
- ✗ Scripts inline maliciosos (se houver XSS)
- ✗ Event handlers inline
- ✗ `javascript:` URLs

**Mitigação:** A sanitização de inputs (CORREÇÃO #6) ainda protege contra XSS.

---

## 📝 CHECKLIST DE REATIVAÇÃO

Quando frontend estiver pronto:

### CSRF
- [ ] Função `getCsrfToken()` implementada em todos os HTMLs
- [ ] Função `makeSecureRequest()` implementada
- [ ] Todas as chamadas `fetch()` substituídas
- [ ] Login testado com CSRF
- [ ] Geração de QR Code testada com CSRF
- [ ] CRUD de produtos testado com CSRF
- [ ] Descomentar `applyCsrf` nas rotas
- [ ] Testar novamente todos os fluxos

### CSP
- [ ] Scripts migrados para arquivos `.js` externos
- [ ] HTMLs referenciam scripts externos
- [ ] Remover `'unsafe-inline'` do CSP
- [ ] Testar todas as páginas
- [ ] Verificar console do browser (sem erros CSP)

---

## 🔄 HISTÓRICO DE MUDANÇAS

### Commit Anterior (8f04835)
- ✅ 7 correções críticas implementadas
- ✅ CSRF configurado e aplicado
- ✅ CSP configurado (sem unsafe-inline)
- ❌ Frontend não atualizado → Sistema quebrado

### Este Hotfix
- ✅ CSP com `'unsafe-inline'` (temporário)
- ✅ CSRF removido das rotas (temporário)
- ✅ TODOs adicionados para rastreabilidade
- ✅ Sistema funcionando novamente

---

## 📞 SUPORTE

Se encontrar problemas:

1. **Login não funciona:** Verificar se .env tem ADMIN_PASS em formato bcrypt
2. **Página em branco:** Verificar console do browser (erros JavaScript)
3. **403 Forbidden:** CSRF ainda ativo em alguma rota (verificar TODOs)
4. **CSP errors:** Verificar se `'unsafe-inline'` está no CSP

---

**STATUS ATUAL:** ✅ Sistema funcional com segurança reduzida temporariamente

**PRÓXIMA ETAPA:** Implementar CSRF tokens no frontend (PRIORITÁRIO)

**TEMPO ESTIMADO:** 2-4 horas de trabalho no frontend
