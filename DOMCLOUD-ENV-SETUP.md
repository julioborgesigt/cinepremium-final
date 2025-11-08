# 🌐 Configuração de Variáveis de Ambiente no DomCloud

## ⚠️ Problema Comum

Ao executar `npm run test-redis` no DomCloud, você pode ver:
```
❌ REDIS_URL não está definido no .env
```

**Isso acontece porque:**
- O arquivo `.env` **não existe** no servidor (e não deveria - está no `.gitignore`)
- Variáveis de ambiente precisam ser configuradas pelo **painel do DomCloud**

---

## ✅ Solução: Configurar Variáveis no DomCloud

### Método 1: Via Painel Web (Recomendado)

1. **Acesse:** https://domcloud.co/user/host
2. **Clique** no seu domínio (ex: `cinepremiumedit.domcloud.dev`)
3. **Procure** a seção **"Environment Variables"** ou **"Deployment"**
4. **Adicione** as variáveis:

```bash
REDIS_URL=redis://default:SUA_SENHA@seu-host.cloud.redislabs.com:12345
DB_HOST=seu-host-mysql
DB_USER=seu_usuario
DB_PASSWORD=sua_senha
DB_NAME=cinepremium
SESSION_SECRET=seu-secret-super-seguro-aqui
ONDAPAY_EMAIL=seu-email@ondapay.com
ONDAPAY_PASSWORD=sua-senha-ondapay
WEBHOOK_URL=https://seu-dominio.domcloud.dev/ondapay-webhook
NODE_ENV=production
ALLOWED_ORIGINS=https://seu-dominio.domcloud.dev
```

5. **Salve** e **reinicie** o servidor/aplicação

---

### Método 2: Via SSH (Alternativo)

Se o painel não tiver interface de variáveis de ambiente:

1. **Conecte via SSH:**
   ```bash
   ssh usuario@seu-dominio.domcloud.dev
   ```

2. **Edite o arquivo de configuração do app:**
   ```bash
   cd ~/public_html
   nano .env.production
   ```

3. **Cole todas as variáveis** (igual ao exemplo acima)

4. **Modifique o start script** para carregar esse arquivo:

   No `package.json`:
   ```json
   "start": "NODE_ENV=production node -r dotenv/config server.js dotenv_config_path=.env.production"
   ```

5. **Reinicie** o servidor

---

### Método 3: Via Deployment YAML (Avançado)

DomCloud pode usar arquivo `.domcloud/deploy.yml`:

1. **Crie** o arquivo `.domcloud/deploy.yml`:
   ```yaml
   features:
     - node
   nginx:
     root: public_html/public
     passenger:
       enabled: on
       app_start_command: env NODE_ENV=production REDIS_URL=redis://... node server.js
   ```

2. **Faça deploy** pelo painel

---

## 🧪 Verificar se Funcionou

### Opção 1: Script de Verificação (Mais Fácil)

```bash
cd ~/public_html
npm run check-env
```

**Saída esperada:**
```
🔍 Verificando variáveis de ambiente...

📋 Variáveis OBRIGATÓRIAS:

   ✅ REDIS_URL = redis://de...
   ✅ DB_HOST = localhost
   ✅ DB_USER = usuario
   ✅ DB_NAME = cinepremium
   ✅ SESSION_SECRET = super-secr...
   ✅ ONDAPAY_EMAIL = email@onda...
   ✅ ONDAPAY_PASSWORD = senha...
   ✅ WEBHOOK_URL = https://ci...

✅ TODAS as variáveis obrigatórias estão configuradas!
```

### Opção 2: Testar Redis

```bash
npm run test-redis
```

**Saída esperada:**
```
✅ Conectado ao Redis com sucesso!
```

---

## 🔍 Troubleshooting

### Ainda dá erro "REDIS_URL não está definido"?

**Teste manualmente:**
```bash
echo $REDIS_URL
```

- **Se retornar vazio:** Variável não está configurada
- **Se retornar a URL:** Variável está OK, problema é no script

**Solução:** Passe a URL diretamente:
```bash
node test-redis-connection.js "redis://default:senha@host:12345"
```

---

### Variável configurada mas não aparece?

**Reinicie o servidor Node.js:**

```bash
# Via painel DomCloud: botão "Restart"
# Ou via SSH:
killall node
npm start
```

Variáveis de ambiente são carregadas **quando o processo inicia**, então mudanças exigem reinício.

---

### DomCloud não tem opção de Environment Variables?

**Use arquivo de ambiente:**

1. Crie `.env.production` (não commitar!)
2. Configure `start` script para carregar:
   ```json
   "start": "node -r dotenv/config server.js dotenv_config_path=.env.production"
   ```

---

## 📋 Checklist de Deploy

- [ ] Configurar REDIS_URL no painel
- [ ] Configurar variáveis do MySQL (DB_HOST, DB_USER, etc)
- [ ] Configurar SESSION_SECRET
- [ ] Configurar credenciais OndaPay
- [ ] Configurar WEBHOOK_URL com seu domínio real
- [ ] Configurar ALLOWED_ORIGINS
- [ ] Executar `npm run check-env` para validar
- [ ] Executar `npm run test-redis` para testar Redis
- [ ] Executar `npm run migrate` para atualizar banco
- [ ] Reiniciar servidor Node.js

---

## 🆘 Ainda com Problemas?

Execute e me envie a saída:
```bash
npm run check-env
```

Isso vai mostrar exatamente qual variável está faltando!
