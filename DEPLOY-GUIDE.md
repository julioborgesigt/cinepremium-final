# Guia Completo de Deploy - CinePremium
## Deploy em Produção Passo a Passo

**Versão:** 2.0.0
**Data:** 07/11/2025
**Última atualização:** Após implementação de todas as correções críticas

---

## 📋 Índice

1. [Pré-requisitos](#pré-requisitos)
2. [Checklist Pré-Deploy](#checklist-pré-deploy)
3. [Configuração de Variáveis de Ambiente](#configuração-de-variáveis-de-ambiente)
4. [Configuração do Redis](#configuração-do-redis)
5. [Migração do Banco de Dados](#migração-do-banco-de-dados)
6. [Deploy no DomCloud.co](#deploy-no-domcloudco)
7. [Deploy em Outros Ambientes](#deploy-em-outros-ambientes)
8. [Testes Pós-Deploy](#testes-pós-deploy)
9. [Troubleshooting](#troubleshooting)
10. [Rollback](#rollback)
11. [Monitoramento](#monitoramento)

---

## Pré-requisitos

### Ferramentas Necessárias

- ✅ Node.js >= 14.x
- ✅ npm >= 6.x
- ✅ MySQL >= 5.7
- ✅ Git
- ✅ Acesso SSH ao servidor (se aplicável)

### Serviços Externos

- ✅ Conta Redis Cloud (grátis) - Ver [REDIS-SETUP-GUIDE.md](./REDIS-SETUP-GUIDE.md)
- ✅ Conta OndaPay com credenciais
- ✅ Projeto Firebase configurado

### Arquivos Importantes

```
cinepremium-final/
├── .env.example          # Template de configuração
├── migrate-database.js   # Script de migração
├── REDIS-SETUP-GUIDE.md  # Guia de Redis
├── DEPLOY-GUIDE.md       # Este arquivo
└── AUDIT-REPORT-2.md     # Relatório de auditoria
```

---

## Checklist Pré-Deploy

### ⚠️ CRÍTICO - Faça Backup!

```bash
# 1. Backup do banco de dados
mysqldump -u usuario -p nome_do_banco > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Backup do código atual
git stash
git checkout -b backup-pre-deploy
git stash pop
git commit -am "Backup antes do deploy $(date +%Y-%m-%d)"
```

### ✅ Verificações Obrigatórias

- [ ] Código em produção está na branch correta
- [ ] Todas as dependências estão instaladas (`npm install`)
- [ ] Backup do banco de dados criado
- [ ] Backup do código criado
- [ ] Redis Cloud configurado (ver próxima seção)
- [ ] Credenciais OndaPay válidas
- [ ] Firebase configurado
- [ ] Acesso SSH ao servidor funcionando

---

## Configuração de Variáveis de Ambiente

### 1. Copiar Template

```bash
# Se ainda não tem .env
cp .env.example .env
```

### 2. Configurar .env

Edite o arquivo `.env` com suas credenciais reais:

```bash
# ============================================
# AMBIENTE
# ============================================
NODE_ENV=production
PORT=3000

# ============================================
# REDIS (OBRIGATÓRIO EM PRODUÇÃO)
# ============================================
# Formato: redis://usuario:senha@host:porta
# Exemplo de Redis Cloud:
REDIS_URL=redis://default:SUA_SENHA@redis-12345.c123.us-east-1-4.ec2.cloud.redislabs.com:12345

# ============================================
# SEGURANÇA
# ============================================
# Gerar SESSION_SECRET:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=COLE_AQUI_O_SECRET_GERADO

# CORS - Domínios permitidos (separados por vírgula)
ALLOWED_ORIGINS=https://seu-dominio.com,https://www.seu-dominio.com

# ============================================
# AUTENTICAÇÃO
# ============================================
ADMIN_USER=admin

# Gerar ADMIN_PASS com bcrypt:
# npm run hash-password sua_senha_forte
ADMIN_PASS=$2b$10$COLE_AQUI_O_HASH_BCRYPT

# ============================================
# BANCO DE DADOS
# ============================================
DB_NAME=nome_do_banco
DB_USER=usuario_do_banco
DB_PASS=senha_do_banco
DB_HOST=localhost

# ============================================
# ONDAPAY
# ============================================
ONDAPAY_CLIENT_ID=seu_client_id
ONDAPAY_CLIENT_SECRET=seu_client_secret
ONDAPAY_WEBHOOK_SECRET=seu_webhook_secret

# ============================================
# FIREBASE
# ============================================
# Converter credenciais para Base64:
# node -e "console.log(Buffer.from(require('fs').readFileSync('firebase-credentials.json')).toString('base64'))"
FIREBASE_CREDENTIALS_BASE64=COLE_AQUI_O_BASE64

FIREBASE_API_KEY=sua_api_key
FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
FIREBASE_PROJECT_ID=seu-projeto-id
FIREBASE_STORAGE_BUCKET=seu-projeto.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=123456789012
FIREBASE_APP_ID=1:123456789012:web:abc123
FIREBASE_VAPID_KEY=sua_vapid_key
```

### 3. Gerar Valores Necessários

#### SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Saída: a1b2c3d4e5f6...
# Copie e cole em SESSION_SECRET
```

#### ADMIN_PASS (Hash bcrypt)

```bash
npm run hash-password SuaSenhaForte123
# Saída: Hash gerado: $2b$10$...
# Copie e cole em ADMIN_PASS
```

#### FIREBASE_CREDENTIALS_BASE64

```bash
# 1. Baixe firebase-credentials.json do Firebase Console
# 2. Execute:
node -e "console.log(Buffer.from(require('fs').readFileSync('firebase-credentials.json')).toString('base64'))"
# 3. Copie a saída para FIREBASE_CREDENTIALS_BASE64
```

### 4. Validar Configuração

```bash
# Verificar se todas as variáveis obrigatórias estão definidas
node -e "
require('dotenv').config();
const required = [
  'NODE_ENV',
  'REDIS_URL',
  'SESSION_SECRET',
  'ALLOWED_ORIGINS',
  'ADMIN_USER',
  'ADMIN_PASS',
  'DB_NAME',
  'DB_USER',
  'DB_PASS',
  'ONDAPAY_CLIENT_ID',
  'ONDAPAY_CLIENT_SECRET',
  'ONDAPAY_WEBHOOK_SECRET'
];
const missing = required.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.log('❌ Variáveis faltando:', missing.join(', '));
  process.exit(1);
} else {
  console.log('✅ Todas as variáveis obrigatórias estão definidas');
}
"
```

---

## Configuração do Redis

### Opção Recomendada: Redis Cloud (Grátis)

Siga o guia completo em [REDIS-SETUP-GUIDE.md](./REDIS-SETUP-GUIDE.md)

**Resumo rápido:**

1. Acesse https://redis.com/try-free/
2. Crie conta gratuita
3. Crie database (Free - 30MB)
4. Copie Public endpoint e Password
5. Monte REDIS_URL:
   ```
   redis://default:SENHA@PUBLIC_ENDPOINT
   ```
6. Cole no `.env`

### Testar Conexão Redis

```bash
# Instale redis-cli (opcional)
brew install redis  # macOS
# ou
sudo apt install redis-tools  # Linux

# Teste a conexão
redis-cli -u "REDIS_URL_COMPLETA" ping
# Resposta esperada: PONG
```

---

## Migração do Banco de Dados

### ⚠️ IMPORTANTE

Execute a migração **APENAS UMA VEZ** e **ANTES** de iniciar a aplicação em produção.

### Passos

#### 1. Testar Migração Localmente (Recomendado)

```bash
# 1. Configure .env com credenciais de desenvolvimento
# 2. Execute a migração
node migrate-database.js
```

**Saída esperada:**

```
============================================================
MIGRAÇÃO DE BANCO DE DADOS - CINEPREMIUM
============================================================

[1/7] Testando conexão com o banco de dados...
✅ Conexão estabelecida

[2/7] Convertendo coluna status para ENUM...
✅ Coluna status convertida para ENUM

[3/7] Criando índice idx_telefone...
✅ Índice 'idx_telefone' criado

[4/7] Criando índice idx_dataTransacao...
✅ Índice 'idx_dataTransacao' criado

[5/7] Criando índice composto idx_telefone_dataTransacao...
✅ Índice 'idx_telefone_dataTransacao' criado

[6/7] Criando índice idx_status...
✅ Índice 'idx_status' criado

[7/7] Adicionando constraint UNIQUE ao transactionId...
✅ Constraint UNIQUE adicionada ao transactionId

============================================================
MIGRAÇÃO CONCLUÍDA COM SUCESSO!
============================================================
✅ 6 alteração(ões) aplicada(s)
✅ Tempo decorrido: 1.23s
```

#### 2. Executar em Produção

```bash
# Via SSH no servidor
ssh usuario@domcloud.co

cd /caminho/para/cinepremium-final

# Verificar .env está configurado
cat .env | grep -E "^DB_"

# Executar migração
node migrate-database.js
```

#### 3. Verificar Migração

```bash
# Conectar ao MySQL
mysql -u usuario -p nome_do_banco

# Verificar índices criados
SHOW INDEX FROM purchase_histories;

# Verificar tipo da coluna status
DESCRIBE purchase_histories;

# Sair
exit
```

**Esperado:**

```
Table: purchase_histories
Column: status
Type: enum('Gerado','Sucesso','Falhou','Expirado')
```

---

## Deploy no DomCloud.co

### 1. Preparar Repositório

```bash
# 1. Commit todas as mudanças
git add -A
git commit -m "chore: Preparar para deploy em produção"

# 2. Push para o GitHub
git push origin main
```

### 2. Configurar no DomCloud.co

#### Via Painel Web

1. Acesse https://domcloud.co/
2. Login na sua conta
3. Selecione seu site
4. Vá em **"Deploy"** > **"GitHub"**
5. Configure:
   - Repository: `julioborgesigt/cinepremium-final`
   - Branch: `main`
   - Build command: `npm install`
   - Start command: `npm start`

#### Via SSH

```bash
# 1. Conectar via SSH
ssh seu-usuario@domcloud.co

# 2. Navegar até o diretório
cd /home/seu-usuario/public_html

# 3. Clonar ou pull do repositório
git pull origin main
# ou
git clone https://github.com/julioborgesigt/cinepremium-final.git .

# 4. Instalar dependências
npm install --production

# 5. Configurar .env
nano .env
# Cole as configurações de produção
# Ctrl+X, Y, Enter para salvar

# 6. Executar migração
node migrate-database.js

# 7. Iniciar aplicação
npm start
```

### 3. Configurar Variáveis de Ambiente no DomCloud

Se o DomCloud tiver suporte a variáveis de ambiente via painel:

1. Vá em **"Settings"** > **"Environment Variables"**
2. Adicione todas as variáveis do `.env`
3. Salve

### 4. Configurar Nginx (se necessário)

```nginx
# /etc/nginx/sites-available/seu-site

server {
    listen 80;
    server_name seu-dominio.com www.seu-dominio.com;

    # Redirecionar para HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name seu-dominio.com www.seu-dominio.com;

    # Certificados SSL (Let's Encrypt)
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 5. Configurar PM2 (Process Manager)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Criar arquivo ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'cinepremium',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
EOF

# Criar diretório de logs
mkdir -p logs

# Iniciar com PM2
pm2 start ecosystem.config.js

# Salvar configuração
pm2 save

# Configurar para iniciar no boot
pm2 startup

# Verificar status
pm2 status

# Ver logs
pm2 logs cinepremium
```

---

## Deploy em Outros Ambientes

### Heroku

```bash
# 1. Criar app
heroku create cinepremium

# 2. Adicionar addons
heroku addons:create heroku-redis:mini
heroku addons:create cleardb:ignite

# 3. Configurar variáveis
heroku config:set NODE_ENV=production
heroku config:set SESSION_SECRET=...
heroku config:set ALLOWED_ORIGINS=...
# ... (todas as outras variáveis)

# 4. Deploy
git push heroku main

# 5. Executar migração
heroku run node migrate-database.js

# 6. Ver logs
heroku logs --tail
```

### VPS (Ubuntu/Debian)

```bash
# 1. Atualizar sistema
sudo apt update && sudo apt upgrade -y

# 2. Instalar Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Instalar MySQL
sudo apt install -y mysql-server

# 4. Instalar Redis (opcional, ou use Redis Cloud)
sudo apt install -y redis-server
sudo systemctl enable redis-server

# 5. Clonar repositório
git clone https://github.com/julioborgesigt/cinepremium-final.git
cd cinepremium-final

# 6. Instalar dependências
npm install --production

# 7. Configurar .env
nano .env

# 8. Executar migração
node migrate-database.js

# 9. Configurar PM2 (ver seção anterior)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# 10. Configurar Nginx (ver seção anterior)
```

---

## Testes Pós-Deploy

### Checklist de Testes

#### 1. Verificar Startup

```bash
# Ver logs do servidor
tail -f logs/combined.log
# ou
pm2 logs cinepremium

# Procurar por:
# ✅ Redis conectado com sucesso
# ✅ Redis pronto para uso
# ✅ Token OndaPay obtido com sucesso
# ✅ Servidor rodando na porta 3000
```

#### 2. Testar Endpoints

```bash
# Página inicial
curl -I https://seu-dominio.com/
# Esperado: HTTP/2 200

# API de produtos
curl https://seu-dominio.com/api/products
# Esperado: JSON com produtos

# Firebase config
curl https://seu-dominio.com/api/firebase-config
# Esperado: JSON com configuração
```

#### 3. Testar Login

1. Acesse: `https://seu-dominio.com/login`
2. Faça login com `ADMIN_USER` e senha
3. Verifique se redireciona para `/admin`
4. Verifique se permanece logado após refresh

#### 4. Testar Persistência de Sessão

1. Faça login
2. **Reinicie o servidor:**
   ```bash
   pm2 restart cinepremium
   ```
3. Recarregue a página do admin
4. ✅ **Deve continuar logado** (Redis funcionando)
5. ❌ **Se deslogou** = Redis não está funcionando

#### 5. Testar Geração de QR Code

1. Acesse a página inicial
2. Selecione um produto
3. Preencha os dados
4. Clique em "Gerar QR Code"
5. Verifique se o QR Code é gerado

#### 6. Testar Webhook (Simulação)

```bash
# Simular webhook da OndaPay
curl -X POST https://seu-dominio.com/ondapay-webhook \
  -H "Content-Type: application/json" \
  -H "x-ondapay-signature: teste" \
  -d '{
    "status": "PAID_OUT",
    "transaction_id": "tx123",
    "external_id": "1"
  }'
```

#### 7. Verificar Performance dos Índices

```sql
-- Conectar ao MySQL
mysql -u usuario -p nome_do_banco

-- Testar query com índice
EXPLAIN SELECT * FROM purchase_histories
WHERE telefone = '11999999999'
AND dataTransacao >= DATE_SUB(NOW(), INTERVAL 1 HOUR);

-- Deve mostrar "Using index" na coluna Extra
```

#### 8. Testar Notificações Push (Opcional)

1. No admin, clique em "Ativar Notificações"
2. Permita notificações no navegador
3. Gere um QR Code na página inicial
4. Verifique se recebeu notificação no admin

---

## Troubleshooting

### Problema: Servidor não inicia

**Sintomas:**
```
Error: Cannot find module 'connect-redis'
```

**Solução:**
```bash
npm install
# ou se persistir:
rm -rf node_modules package-lock.json
npm install
```

---

### Problema: Redis não conecta

**Sintomas:**
```
❌ Falha ao conectar ao Redis
⚠️ Usando MemoryStore como fallback
```

**Soluções:**

1. **Verificar REDIS_URL:**
   ```bash
   echo $REDIS_URL
   # Deve estar no formato: redis://usuario:senha@host:porta
   ```

2. **Testar conexão:**
   ```bash
   redis-cli -u "$REDIS_URL" ping
   # Esperado: PONG
   ```

3. **Verificar firewall:**
   - No Redis Cloud, verifique se o IP do servidor está permitido

---

### Problema: CORS bloqueando requisições

**Sintomas:**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**Solução:**
```bash
# Verificar ALLOWED_ORIGINS no .env
echo $ALLOWED_ORIGINS

# Deve conter TODOS os domínios, incluindo www
ALLOWED_ORIGINS=https://dominio.com,https://www.dominio.com
```

---

### Problema: Sessão expira imediatamente

**Sintomas:**
- Faz login mas volta para /login
- Console mostra "Sessão expirada"

**Soluções:**

1. **Verificar trust proxy:**
   ```javascript
   // server.js deve ter:
   app.set('trust proxy', 1);
   ```

2. **Verificar cookies:**
   ```bash
   # No navegador, DevTools > Application > Cookies
   # Deve ter cookie "sessionId"
   # Secure: true em produção
   # SameSite: Lax
   ```

3. **Verificar HTTPS:**
   - Em produção, **SEMPRE use HTTPS**
   - Se não tiver SSL, configure no nginx/domcloud

---

### Problema: Migração falha

**Sintomas:**
```
❌ Falha ao criar índice 'idx_telefone': ...
```

**Soluções:**

1. **Verificar permissões:**
   ```sql
   SHOW GRANTS FOR 'usuario'@'%';
   -- Deve ter: CREATE, INDEX
   ```

2. **Verificar se índice já existe:**
   ```sql
   SHOW INDEX FROM purchase_histories;
   ```

3. **Executar manualmente:**
   ```sql
   CREATE INDEX idx_telefone ON purchase_histories(telefone);
   ```

---

### Problema: OndaPay retorna 401

**Sintomas:**
```
Token da OndaPay expirado. Renovando...
```

**Solução:**
```bash
# Verificar credenciais
echo $ONDAPAY_CLIENT_ID
echo $ONDAPAY_CLIENT_SECRET

# Testar manualmente
curl -X POST https://api.ondapay.app/api/v1/login \
  -H "client_id: $ONDAPAY_CLIENT_ID" \
  -H "client_secret: $ONDAPAY_CLIENT_SECRET"
```

---

## Rollback

### Se algo der errado

#### 1. Rollback do Código

```bash
# Voltar para versão anterior
git log --oneline  # Ver commits
git reset --hard COMMIT_ANTERIOR
git push -f origin main  # Cuidado!

# Ou voltar para branch de backup
git checkout backup-pre-deploy
```

#### 2. Rollback do Banco de Dados

```bash
# Restaurar backup
mysql -u usuario -p nome_do_banco < backup_YYYYMMDD_HHMMSS.sql
```

#### 3. Reverter Migração (se necessário)

```sql
-- Remover índices
DROP INDEX idx_telefone ON purchase_histories;
DROP INDEX idx_dataTransacao ON purchase_histories;
DROP INDEX idx_telefone_dataTransacao ON purchase_histories;
DROP INDEX idx_transactionId ON purchase_histories;
DROP INDEX idx_status ON purchase_histories;

-- Reverter ENUM para VARCHAR
ALTER TABLE purchase_histories
MODIFY COLUMN status VARCHAR(255) NOT NULL DEFAULT 'Gerado';
```

---

## Monitoramento

### Logs

```bash
# PM2
pm2 logs cinepremium --lines 100

# Arquivo
tail -f logs/combined.log

# Filtrar erros
tail -f logs/combined.log | grep "❌"
```

### Métricas

```bash
# CPU e memória
pm2 monit

# Status
pm2 status

# Info detalhada
pm2 info cinepremium
```

### Alertas Importantes

⚠️ **Memória > 80%**
```bash
pm2 restart cinepremium
```

⚠️ **CPU > 90%**
```bash
# Verificar queries lentas no banco
# Verificar logs para loops infinitos
```

⚠️ **Sessões do Redis > 10.000**
```bash
# Considerar aumentar plano do Redis Cloud
# Ou reduzir maxAge das sessões
```

---

## Checklist Final

Antes de considerar o deploy concluído:

- [ ] Servidor iniciou sem erros
- [ ] Redis conectado (ver logs)
- [ ] OndaPay token obtido (ver logs)
- [ ] Login funciona
- [ ] Sessão persiste após restart
- [ ] Produtos carregam
- [ ] QR Code é gerado
- [ ] Webhook recebe notificações (teste manual)
- [ ] Notificações push funcionam (se configurado)
- [ ] Performance está boa (tempo de resposta < 1s)
- [ ] Backup configurado
- [ ] Monitoramento ativo

---

## Recursos Adicionais

- 📘 [REDIS-SETUP-GUIDE.md](./REDIS-SETUP-GUIDE.md) - Guia completo do Redis
- 📘 [AUDIT-REPORT-2.md](./AUDIT-REPORT-2.md) - Relatório de auditoria
- 📘 [README.md](./README.md) - Documentação geral
- 🌐 [Redis Cloud](https://redis.com/try-free/)
- 🌐 [DomCloud Docs](https://domcloud.co/docs)
- 🌐 [PM2 Docs](https://pm2.keymetrics.io/docs)

---

**Criado em:** 07/11/2025
**Versão:** 2.0.0
**Autor:** Claude Code Agent
