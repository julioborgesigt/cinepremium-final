# 🔒 Guia de Segurança: Arquivo .env no Servidor

## ⚠️ Riscos de Segurança

### 🔴 PERIGO: .env Acessível Publicamente

Se o arquivo `.env` estiver **dentro da pasta pública do Nginx**, qualquer pessoa pode acessá-lo:

```
https://seu-dominio.com/.env
```

**Consequências:**
- ❌ Todas as senhas expostas (DB, Redis, OndaPay)
- ❌ Credenciais Firebase vazadas
- ❌ Session secrets comprometidos
- ❌ Invasores podem acessar banco de dados
- ❌ Invasores podem fazer pagamentos falsos via OndaPay

---

## ✅ Como Criar .env de Forma SEGURA

### 1️⃣ Estrutura de Pastas Correta

```
~/public_html/                    ← Raiz da aplicação
├── .env                          ✅ AQUI (fora do nginx root)
├── server.js
├── package.json
├── models/
└── public/                       ← ROOT do Nginx
    ├── index.html                ← Nginx serve APENAS esta pasta
    ├── admin.html
    └── assets/
```

**NUNCA coloque aqui:**
```
~/public_html/public/.env         ❌ PERIGO!
```

---

### 2️⃣ Permissões Corretas

Após criar o `.env`, configure permissões restritas:

```bash
chmod 600 .env
```

**O que significa:**
- `6` = Dono: leitura + escrita
- `0` = Grupo: nenhum acesso
- `0` = Outros: nenhum acesso

**Verificar permissões:**
```bash
ls -la .env
# Deve mostrar: -rw------- (600)
```

---

### 3️⃣ Verificação de Segurança Automática

Execute o script de verificação:

```bash
npm run verify-security
```

**Saída esperada (SEGURO):**
```
🔒 Verificando segurança do arquivo .env...

📍 Localização do .env:
/home/usuario/public_html
-rw------- 1 usuario grupo 1234 Nov 08 10:00 .env

🔐 Permissões atuais: 600
   ✅ Permissões SEGURAS (apenas dono pode ler)

🌐 Verificando proteção do Nginx...
   ℹ️  No DomCloud, arquivos começando com '.' geralmente são bloqueados

🧪 Testando se .env é acessível via web...
   ✅ SEGURO: .env NÃO está acessível (HTTP 404)

✅ Verificação concluída!
```

---

### 4️⃣ Teste Manual

Acesse no navegador:
```
https://seu-dominio.com/.env
https://seu-dominio.com/../.env
```

**Resultado esperado:**
- ✅ **404 Not Found** ou **403 Forbidden** = SEGURO
- ❌ **200 OK** (mostra conteúdo) = PERIGO!

---

## 🛡️ Comparação: .env vs env_var_list

### env_var_list (YML) - Mais Seguro

```yaml
passenger:
  env_var_list:
    - REDIS_URL=redis://...
```

**Vantagens:**
- ✅ Variáveis ficam apenas na memória do processo
- ✅ Não existe arquivo físico para vazar
- ✅ Mais difícil de expor acidentalmente

**Desvantagens:**
- ❌ Não funciona em comandos SSH manuais
- ❌ Precisa reiniciar Passenger para atualizar

---

### .env (Arquivo) - Conveniente mas Requer Cuidado

**Vantagens:**
- ✅ Funciona em SSH e na aplicação
- ✅ Fácil de atualizar (sem restart)
- ✅ Padrão da indústria

**Desvantagens:**
- ❌ Arquivo físico pode vazar se mal configurado
- ❌ Requer permissões corretas
- ❌ Precisa garantir que não está no public root

---

## 🎯 Recomendação Final

### Para DomCloud: Use AMBOS

**1. env_var_list (produção):**
```yaml
passenger:
  env_var_list:
    - REDIS_URL=redis://...
    - DB_PASSWORD=...
```
✅ Aplicação usa essas variáveis

**2. .env (desenvolvimento/testes):**
```bash
# Em ~/public_html/.env (FORA de public/)
REDIS_URL=redis://...
DB_PASSWORD=...
```
✅ Scripts de teste/migração usam esse arquivo

**Configuração no código:**
```javascript
// server.js já faz isso corretamente
require('dotenv').config(); // Tenta carregar .env
// Se não existir, usa process.env do Passenger
```

---

## 📋 Checklist de Segurança

Antes de criar `.env` no servidor, verifique:

- [ ] **Localização**: `.env` está em `~/public_html/` (NÃO em `public/`)
- [ ] **Permissões**: `chmod 600 .env` executado
- [ ] **.gitignore**: `.env` está ignorado (não commitar!)
- [ ] **Nginx**: Root está em `public/`, não em `public_html/`
- [ ] **Teste web**: `https://dominio.com/.env` retorna 404
- [ ] **Backup seguro**: Se fizer backup, criptografe

---

## 🚨 O Que Fazer Se .env Foi Exposto

Se você descobrir que `.env` estava acessível publicamente:

### 1. **Remova imediatamente:**
```bash
rm .env
```

### 2. **Troque TODAS as credenciais:**
- [ ] Senha do banco MySQL
- [ ] REDIS_URL (regenere senha no Redis Cloud)
- [ ] SESSION_SECRET (gere novo: `openssl rand -base64 32`)
- [ ] ONDAPAY_CLIENT_SECRET (regenere no painel OndaPay)
- [ ] Credenciais Firebase (desabilite a antiga, crie nova)

### 3. **Revogue sessões ativas:**
```bash
# No Redis
redis-cli KEYS "cinepremium:sess:*" | xargs redis-cli DEL
```

### 4. **Monitore logs:**
- Verifique acessos suspeitos no banco de dados
- Verifique transações não autorizadas no OndaPay
- Ative alertas de segurança

---

## 🔐 Alternativas ao .env no Servidor

Se você quer **máxima segurança**:

### 1. **Usar apenas env_var_list** (YML)
- Para testes SSH, passe variáveis manualmente
- Use scripts como `test-redis-domcloud.sh` com valores hardcoded

### 2. **Secrets Manager** (AWS, GCP, Azure)
- Variáveis não ficam em arquivos
- Aplicação busca secrets de serviço externo

### 3. **Variáveis de Ambiente do Sistema**
```bash
# Em ~/.bashrc
export REDIS_URL="redis://..."
```
- Funciona em SSH e aplicação
- Mas cuidado: visível para outros processos do usuário

---

## 📊 Matriz de Decisão

| Cenário | Recomendação | Segurança |
|---------|--------------|-----------|
| Produção DomCloud | env_var_list (YML) | ⭐⭐⭐⭐⭐ |
| Testes no servidor | .env em `~/public_html/` (600) | ⭐⭐⭐⭐ |
| Desenvolvimento local | .env no repositório local | ⭐⭐⭐⭐⭐ |
| Scripts CI/CD | Secrets do GitHub/GitLab | ⭐⭐⭐⭐⭐ |

---

## ✅ Conclusão

**Criar `.env` no servidor É SEGURO** se:

1. ✅ Está em `~/public_html/` (FORA de `public/`)
2. ✅ Permissões são `600` (`chmod 600 .env`)
3. ✅ Nginx root é `public/` (não `public_html/`)
4. ✅ Teste manual confirma 404

**Use o script de verificação:**
```bash
npm run verify-security
```

Se todos os checks passarem, está seguro! 🎉
