# Guia de Instalação e Configuração do Redis para Produção
## CinePremium - Session Store

**Data:** 07/11/2025
**Versão:** 1.0.0

---

## 📋 Índice

1. [Por que Redis?](#por-que-redis)
2. [Opções de Instalação](#opções-de-instalação)
3. [Opção 1: Redis Cloud (Recomendado - Grátis)](#opção-1-redis-cloud-recomendado---grátis)
4. [Opção 2: Redis no DomCloud.co](#opção-2-redis-no-domcloudco)
5. [Opção 3: Redis Local (Desenvolvimento)](#opção-3-redis-local-desenvolvimento)
6. [Opção 4: Redis em Docker](#opção-4-redis-em-docker)
7. [Configuração da Aplicação](#configuração-da-aplicação)
8. [Testes e Validação](#testes-e-validação)
9. [Troubleshooting](#troubleshooting)
10. [Monitoramento](#monitoramento)

---

## Por que Redis?

### ❌ Problema com MemoryStore (Padrão)

```javascript
// SEM Redis (MemoryStore) - PROBLEMAS:
app.use(session({
  secret: process.env.SESSION_SECRET
  // store: undefined = MemoryStore (PADRÃO)
}));
```

**Problemas:**
1. 💥 **Vazamento de memória** - Sessões nunca são limpas automaticamente
2. 🔄 **Sessões perdidas** - Reiniciar servidor = todos os usuários deslogados
3. ⚖️ **Não escalável** - Com 2+ servidores, cada um tem suas próprias sessões
4. 📈 **Crash inevitável** - Com o tempo, memória se esgota

### ✅ Solução com Redis

```javascript
// COM Redis - BENEFÍCIOS:
const sessionStore = new RedisStore({ client: redisClient });
app.use(session({ store: sessionStore }));
```

**Benefícios:**
1. ✅ Sessões persistem em disco
2. ✅ Restart = usuários continuam logados
3. ✅ Load balancing funciona
4. ✅ TTL automático (sessões expiradas são deletadas)

---

## Opções de Instalação

| Opção | Custo | Dificuldade | Recomendado Para |
|-------|-------|-------------|------------------|
| **Redis Cloud** | 🆓 Grátis (30MB) | ⭐ Fácil | Produção (RECOMENDADO) |
| **DomCloud.co** | 💰 Pago | ⭐⭐ Médio | Produção (se disponível) |
| **Docker** | 🆓 Grátis | ⭐⭐⭐ Difícil | Desenvolvimento |
| **Local** | 🆓 Grátis | ⭐⭐ Médio | Desenvolvimento |

---

## Opção 1: Redis Cloud (Recomendado - Grátis)

### ✨ Por que usar Redis Cloud?

- 🆓 **30MB grátis** (suficiente para ~10.000 sessões)
- 🌍 **Global** - Funciona de qualquer lugar
- 🔒 **SSL/TLS** incluído
- 📊 **Dashboard** para monitoramento
- 🔄 **Auto-backup**
- ⚡ **Baixa latência**

### 📝 Passo a Passo

#### 1. Criar Conta

1. Acesse: https://redis.com/try-free/
2. Clique em **"Get started free"**
3. Preencha:
   - Email
   - Password
   - Company name: `CinePremium` (ou seu nome)
4. Verifique seu email
5. Faça login

#### 2. Criar Database

1. No dashboard, clique em **"Create database"** ou **"New subscription"**
2. Escolha o plano:
   - Selecione: **"Free - Fixed"** (30MB)
   - Clique em **"Continue"**

3. Configure a região:
   - **Cloud vendor:** AWS (ou Google Cloud)
   - **Region:** Escolha a mais próxima do Brasil:
     - `São Paulo` (se disponível)
     - Ou `US East (Virginia)` (menor latência para Brasil)
   - Clique em **"Continue"**

4. Database settings:
   - **Database name:** `cinepremium-sessions`
   - **Redis version:** Deixe o padrão (7.2+)
   - **Eviction policy:** `allkeys-lru` (importante!)
   - Clique em **"Create database"**

5. Aguarde 2-3 minutos enquanto o database é criado

#### 3. Obter Credenciais

1. Quando a criação finalizar, clique no database criado
2. Na aba **"Configuration"**, encontre:
   - **Public endpoint:** Algo como `redis-12345.c123.us-east-1-4.ec2.cloud.redislabs.com:12345`
   - **Default user password:** Clique em 👁️ para ver a senha

3. Copie as credenciais

#### 4. Montar a URL de Conexão

Formato:
```
redis://default:<PASSWORD>@<HOST>:<PORT>
```

**Exemplo:**
```bash
# Se o endpoint for: redis-12345.c123.us-east-1-4.ec2.cloud.redislabs.com:12345
# E a senha for: Abc123XyZ456

REDIS_URL=redis://default:Abc123XyZ456@redis-12345.c123.us-east-1-4.ec2.cloud.redislabs.com:12345
```

#### 5. Configurar no .env

Adicione ao seu arquivo `.env`:

```bash
NODE_ENV=production
REDIS_URL=redis://default:SUA_SENHA@SEU_HOST:PORTA
```

#### 6. Testar Conexão

```bash
# Instale redis-cli (opcional, mas útil)
# macOS:
brew install redis

# Ubuntu/Debian:
sudo apt-get install redis-tools

# Windows:
# Baixe de: https://github.com/microsoftarchive/redis/releases

# Teste a conexão:
redis-cli -u "redis://default:SUA_SENHA@SEU_HOST:PORTA" ping
# Resposta esperada: PONG
```

---

## Opção 2: Redis no DomCloud.co

### Verificar Disponibilidade

```bash
# SSH no DomCloud.co
ssh seu-usuario@domcloud.co

# Verificar se Redis está disponível
redis-cli --version

# Se disponível, verificar se está rodando
redis-cli ping
```

### Se Disponível (Improvável)

```bash
# Adicione ao .env:
REDIS_URL=redis://localhost:6379
```

### Se NÃO Disponível

**Recomendação:** Use Redis Cloud (Opção 1) - É grátis e mais confiável.

---

## Opção 3: Redis Local (Desenvolvimento)

### Linux (Ubuntu/Debian)

```bash
# Atualizar pacotes
sudo apt update

# Instalar Redis
sudo apt install redis-server -y

# Iniciar Redis
sudo systemctl start redis-server

# Habilitar auto-start
sudo systemctl enable redis-server

# Testar
redis-cli ping
# Resposta: PONG
```

### macOS

```bash
# Com Homebrew
brew install redis

# Iniciar Redis
brew services start redis

# Testar
redis-cli ping
# Resposta: PONG
```

### Windows

**Opção 1: WSL2 (Recomendado)**
```bash
# No WSL2 (Ubuntu)
sudo apt update
sudo apt install redis-server -y
sudo service redis-server start
```

**Opção 2: Docker (Mais fácil)**
```bash
# Ver Opção 4 abaixo
```

### Configuração

```bash
# .env para desenvolvimento
NODE_ENV=development
USE_REDIS=true
REDIS_URL=redis://localhost:6379
```

---

## Opção 4: Redis em Docker

### Pré-requisitos

- Docker instalado: https://docs.docker.com/get-docker/

### Instalação

```bash
# Baixar e rodar Redis
docker run -d \
  --name cinepremium-redis \
  -p 6379:6379 \
  redis:7-alpine

# Verificar se está rodando
docker ps | grep redis

# Testar conexão
docker exec -it cinepremium-redis redis-cli ping
# Resposta: PONG
```

### Com Persistência de Dados

```bash
# Criar volume
docker volume create redis-data

# Rodar com persistência
docker run -d \
  --name cinepremium-redis \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:7-alpine redis-server --save 60 1 --loglevel warning

# Parar
docker stop cinepremium-redis

# Iniciar novamente (dados persistem)
docker start cinepremium-redis
```

### Docker Compose (Avançado)

Crie `docker-compose.yml`:

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: cinepremium-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --save 60 1 --loglevel warning
    restart: unless-stopped

volumes:
  redis-data:
```

```bash
# Iniciar
docker-compose up -d

# Parar
docker-compose down

# Parar e remover dados
docker-compose down -v
```

---

## Configuração da Aplicação

### 1. Variáveis de Ambiente

Adicione ao `.env`:

```bash
# ============================================
# REDIS - SESSION STORE (OBRIGATÓRIO EM PRODUÇÃO)
# ============================================

# URL de conexão
# Formato: redis://[username]:[password]@[host]:[port]

# Redis Cloud (Produção):
REDIS_URL=redis://default:SUA_SENHA@redis-12345.c123.us-east-1-4.ec2.cloud.redislabs.com:12345

# Redis Local (Desenvolvimento):
# REDIS_URL=redis://localhost:6379

# Opcional: Forçar Redis em desenvolvimento
# USE_REDIS=true
```

### 2. Verificar Instalação

```bash
# Instalar dependências (já feito)
npm install

# Verificar package.json
grep -A 2 '"redis"' package.json
# Deve mostrar:
# "redis": "^5.9.0",
# "connect-redis": "^9.0.0",
```

### 3. Iniciar Aplicação

```bash
# Desenvolvimento
npm start

# Produção
NODE_ENV=production npm start
```

### 4. Verificar Logs

Procure por:
```
✅ Redis conectado com sucesso
✅ Redis pronto para uso
```

**OU**, se não configurado:
```
⚠️ Usando MemoryStore para sessões (apenas desenvolvimento)
💡 Para produção, configure REDIS_URL no .env
```

---

## Testes e Validação

### Teste 1: Conexão

```bash
# Inicie a aplicação
npm start

# Procure nos logs:
# ✅ Redis conectado com sucesso
# ✅ Redis pronto para uso
```

### Teste 2: Sessão Persistente

1. **Faça login** no admin
2. **Reinicie o servidor:**
   ```bash
   # Ctrl+C para parar
   npm start
   ```
3. **Recarregue a página** do admin
4. ✅ **Esperado:** Você continua logado
5. ❌ **Se deslogou:** Redis não está funcionando

### Teste 3: Verificar Dados no Redis

```bash
# Com redis-cli local
redis-cli

# Listar todas as chaves de sessão
KEYS cinepremium:sess:*

# Ver uma sessão específica
GET cinepremium:sess:ALGUM_SESSION_ID

# Sair
exit
```

**Com Redis Cloud:**
```bash
redis-cli -u "REDIS_URL_COMPLETA"
KEYS cinepremium:sess:*
exit
```

### Teste 4: Expiração Automática

```bash
# Conectar ao Redis
redis-cli

# Verificar TTL de uma sessão (em segundos)
TTL cinepremium:sess:ALGUM_SESSION_ID
# Resposta: 28800 (8 horas em segundos)

# Aguardar 8 horas ou forçar expiração
EXPIRE cinepremium:sess:ALGUM_SESSION_ID 1

# Após 1 segundo, a sessão some
GET cinepremium:sess:ALGUM_SESSION_ID
# Resposta: (nil)
```

---

## Troubleshooting

### Erro: "ECONNREFUSED" ou "Connection refused"

**Causa:** Redis não está rodando ou URL incorreta

**Soluções:**
```bash
# 1. Verificar se Redis está rodando
# Local:
redis-cli ping

# Cloud:
redis-cli -u "SUA_REDIS_URL" ping

# 2. Verificar URL no .env
echo $REDIS_URL

# 3. Verificar logs da aplicação
npm start | grep Redis
```

### Erro: "NOAUTH Authentication required"

**Causa:** Redis requer senha mas não foi fornecida

**Solução:**
```bash
# Formato correto da URL:
REDIS_URL=redis://default:SUA_SENHA@host:porta

# NÃO esqueça de incluir a senha!
```

### Erro: "Ready check failed"

**Causa:** Redis está demorando para responder

**Soluções:**
```bash
# 1. Verificar latência
redis-cli -u "SUA_REDIS_URL" --latency

# 2. Tentar região mais próxima (Redis Cloud)

# 3. Aumentar timeout no server.js (se necessário)
```

### Aplicação Usa MemoryStore ao invés de Redis

**Verificações:**

```bash
# 1. Confirmar que NODE_ENV está definido
echo $NODE_ENV
# Deve ser: production

# 2. OU definir USE_REDIS=true
echo "USE_REDIS=true" >> .env

# 3. Verificar logs ao iniciar
npm start | grep -i redis
```

### Sessões Não Persistem Após Restart

**Causa:** Redis não está sendo usado

**Solução:**
```bash
# Verificar logs ao iniciar o servidor
# Deve mostrar:
# ✅ Redis conectado com sucesso

# Se mostrar:
# ⚠️ Usando MemoryStore
# = Redis NÃO está ativo
```

---

## Monitoramento

### Redis Cloud Dashboard

1. Acesse: https://app.redislabs.com/
2. Clique no seu database
3. Veja:
   - **Operations/sec** - Requisições por segundo
   - **Memory used** - Memória utilizada
   - **Connected clients** - Clientes conectados
   - **Hit ratio** - Taxa de acerto

### Comandos Úteis

```bash
# Conectar ao Redis
redis-cli -u "SUA_REDIS_URL"

# Ver informações gerais
INFO

# Ver memória usada
INFO memory

# Ver número de chaves
DBSIZE

# Ver clientes conectados
CLIENT LIST

# Monitorar em tempo real
MONITOR
# (Ctrl+C para sair)

# Ver chaves de sessão
KEYS cinepremium:sess:*

# Ver quanto tempo falta para uma sessão expirar
TTL cinepremium:sess:ALGUM_ID
```

### Alertas Importantes

⚠️ **Memória > 90%:**
```
Solução: Deletar sessões antigas ou aumentar plano
```

⚠️ **Hit Ratio < 50%:**
```
Causa: Muitas sessões expiradas ou cache ineficiente
Solução: Ajustar TTL ou aumentar memória
```

⚠️ **Clientes > 10:**
```
Investigar: Por que tantas conexões?
Possível: Vazamento de conexões (verificar código)
```

---

## Backup e Recuperação

### Redis Cloud (Automático)

- ✅ Backup automático diário
- ✅ Restauração via dashboard
- Caminho: Database > Data Persistence > Backups

### Redis Local

```bash
# Backup manual
redis-cli SAVE

# Arquivo salvo em:
# Linux: /var/lib/redis/dump.rdb
# macOS: /usr/local/var/db/redis/dump.rdb

# Restaurar: Copiar dump.rdb de volta e reiniciar Redis
```

---

## Segurança

### ✅ Boas Práticas

1. **Sempre use senha** em produção
2. **SSL/TLS** (Redis Cloud já tem)
3. **Não exponha porta 6379** publicamente
4. **Rotacione senhas** periodicamente
5. **Limite conexões** ao IP da aplicação (firewall)

### Redis Cloud - Configuração de Segurança

1. No dashboard, vá em **"Security"**
2. Configure:
   - **Source IP/Subnet:** IP do seu servidor (se fixo)
   - **SSL/TLS:** Ative se disponível

---

## Custos e Limites

### Redis Cloud - Plano Free

| Recurso | Limite |
|---------|--------|
| Memória | 30 MB |
| Conexões | 30 simultâneas |
| Bandwidth | 30 GB/mês |
| Sessões* | ~10.000 |

*Estimativa: Cada sessão ~3KB

### Quando Atualizar?

Atualize para plano pago quando:
- ✅ Mais de 10.000 usuários ativos
- ✅ Memória > 90% constantemente
- ✅ Necessita replicação/HA

**Planos pagos começam em ~$5/mês**

---

## Checklist Final

Antes de ir para produção:

- [ ] Redis configurado (Cloud, Local ou Docker)
- [ ] `REDIS_URL` definido no `.env`
- [ ] `NODE_ENV=production` configurado
- [ ] Logs mostram "✅ Redis conectado"
- [ ] Teste de login realizado
- [ ] Teste de persistência (restart) funcionando
- [ ] Monitoramento configurado (opcional)
- [ ] Backup automático ativo (Redis Cloud)

---

## Recursos Adicionais

- 📚 [Redis Documentation](https://redis.io/documentation)
- 🎓 [Redis University (Grátis)](https://university.redis.com/)
- 💬 [Redis Community](https://redis.com/community/)
- 🐛 [Troubleshooting Guide](https://redis.io/docs/manual/admin/)

---

## Suporte

### Problemas com Redis Cloud
- 📧 Email: support@redis.com
- 💬 Chat: No dashboard (canto inferior direito)

### Problemas com a Aplicação
- 📝 Verificar logs: `npm start`
- 🔍 Ver AUDIT-REPORT-2.md
- 📖 Ver README.md

---

**Criado em:** 07/11/2025
**Atualizado em:** 07/11/2025
**Versão:** 1.0.0
