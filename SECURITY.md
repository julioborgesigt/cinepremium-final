# Guia de Segurança - CinePremium

## Correções de Segurança Implementadas

Este documento descreve as melhorias de segurança implementadas no projeto CinePremium em 04/11/2025.

---

## 🔐 Melhorias Implementadas

### 1. Headers de Segurança HTTP (Helmet)
- Implementado `helmet.js` para adicionar headers de segurança
- Content Security Policy (CSP) configurada
- Proteção contra clickjacking, XSS e outros ataques

### 2. Rate Limiting
Implementado rate limiting em diferentes níveis:
- **Login**: 5 tentativas por 15 minutos por IP
- **Geração de QR Code**: 10 por hora por IP
- **APIs Admin**: 100 requisições por 15 minutos por IP

### 3. Validação de Entrada (Joi)
- Validação de schemas para geração de QR Code
- Validação de histórico de compras
- Proteção contra SQL Injection

### 4. Verificação de Assinatura no Webhook
- Implementado verificação HMAC SHA256 para webhooks OndaPay
- Prevenção de webhooks fraudulentos
- **IMPORTANTE**: Configure o cabeçalho `x-ondapay-signature` no painel OndaPay

### 5. Sanitização de Logs
- Dados sensíveis (CPF, telefone, nome, email) são mascarados nos logs
- Formato: `Jo***do` em vez de `Joaquim Eduardo`
- Compliance com LGPD

### 6. Cookies Seguros
Cookies de sessão agora possuem:
- `httpOnly: true` - Previne acesso via JavaScript
- `secure: true` - Apenas HTTPS em produção
- `sameSite: 'strict'` - Proteção CSRF

### 7. HTTPS Enforcement
- Redirecionamento automático de HTTP para HTTPS em produção
- Baseado no header `x-forwarded-proto`

### 8. Validação de Upload de Imagens
- Limite de 2MB por imagem
- Apenas formatos permitidos: JPG, PNG, GIF, WebP
- Validação no client-side e server-side

### 9. Remoção de Código Legado
- Removido `body-parser` (integrado no Express)
- Removido endpoint `/debug-env` (expunha configurações)
- Corrigido bug de sintaxe na linha 406

### 10. Melhorias em Autenticação
- Rate limiting no login
- Logs de tentativas de login
- Username armazenado na sessão para auditoria

---

## ⚠️ AÇÕES CRÍTICAS NECESSÁRIAS

### 1. Rotacionar Credenciais

O arquivo `.env` foi commitado no repositório. **TODAS as credenciais devem ser rotacionadas:**

```bash
# 1. Gerar novo SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 2. Mudar ADMIN_PASS para algo forte (mínimo 16 caracteres)
# 3. Rotacionar credenciais do banco de dados
# 4. Rotacionar OndaPay API keys (se possível)
# 5. Verificar Firebase credentials
```

### 2. Remover .env do Git

```bash
# Remover do histórico (cuidado!)
git rm --cached .env

# Commitar
git add .gitignore .env.example
git commit -m "security: Remove .env from repository"

# Push
git push -u origin claude/code-review-audit-011CUoYXgnELinUF3XbRZENh
```

### 3. Configurar Variáveis de Ambiente no Servidor

Adicione estas variáveis no painel de controle do servidor (não use .env em produção):

```
SESSION_SECRET=<novo-secret-64-chars>
ADMIN_USER=admin
ADMIN_PASS=<nova-senha-forte>
ONDAPAY_CLIENT_ID=<seu-client-id>
ONDAPAY_CLIENT_SECRET=<seu-client-secret>
DB_NAME=cinepremiumedit_banco
DB_USER=cinepremiumedit
DB_PASS=<nova-senha-db>
DB_HOST=sao.domcloud.co
FIREBASE_CREDENTIALS_BASE64=<base64-encoded-json>
NODE_ENV=production
PORT=3000
```

### 4. Configurar Webhook OndaPay

No painel OndaPay, configure para enviar o header de assinatura:
- Header: `x-ondapay-signature`
- Algoritmo: HMAC SHA256
- Secret: Use o mesmo `ONDAPAY_CLIENT_SECRET`

Se a OndaPay não suportar assinatura, considere:
- Whitelist de IPs
- Token de autenticação no webhook URL
- Validar campos adicionais únicos

---

## 🔒 Boas Práticas de Segurança

### Em Desenvolvimento

```bash
# Sempre use .env para desenvolvimento local
cp .env.example .env
# Edite .env com suas credenciais locais
```

### Em Produção

1. **NUNCA** commite o arquivo `.env`
2. Use variáveis de ambiente do servidor
3. Ative `NODE_ENV=production`
4. Monitore logs de erro
5. Configure backups automáticos do banco
6. Mantenha dependências atualizadas: `npm audit` regularmente

### Monitoramento

Monitore estes logs para atividades suspeitas:

```bash
# Tentativas de login falhas
grep "\[AUTH\] Tentativa de login falhou" logs/

# Rate limiting acionado
grep "Too many requests" logs/

# Webhooks com assinatura inválida
grep "Assinatura inválida" logs/
```

---

## 📋 Checklist de Segurança

### Imediato (Feito)
- [x] Headers de segurança HTTP
- [x] Rate limiting
- [x] Validação de inputs
- [x] Sanitização de logs
- [x] Cookies seguros
- [x] HTTPS enforcement
- [x] Validação de upload de imagem
- [x] Verificação de assinatura no webhook

### Urgente (A Fazer)
- [ ] Rotacionar todas as credenciais
- [ ] Remover .env do histórico do Git
- [ ] Configurar variáveis de ambiente no servidor
- [ ] Configurar assinatura de webhook no OndaPay
- [ ] Testar em staging antes de deploy

### Recomendado (Próximos 30 dias)
- [ ] Implementar testes automatizados
- [ ] Adicionar logging estruturado (Winston)
- [ ] Configurar monitoramento (Sentry)
- [ ] Implementar migrations do Sequelize
- [ ] Adicionar autenticação 2FA para admin
- [ ] Configurar backups automáticos do banco
- [ ] Implementar CI/CD

---

## 🆘 Contato de Segurança

Se você descobrir uma vulnerabilidade de segurança, **NÃO** abra uma issue pública.

Envie um email para: cinepremium.sac@gmail.com

---

## 📚 Referências

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [LGPD - Lei Geral de Proteção de Dados](https://www.gov.br/cidadania/pt-br/acesso-a-informacao/lgpd)

---

**Última Atualização**: 04/11/2025
