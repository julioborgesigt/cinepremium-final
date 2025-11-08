# 🔧 GUIA DE CORREÇÃO: Habilitar Redis para Sessões

## Problema Encontrado em 3 Partes

1. **Configuração faltando**: `.env` não tem `REDIS_URL` definido
2. **Race condition**: Promise do Redis não é aguardada
3. **Timing**: Middleware registrado antes de Redis estar pronto

---

## Solução em 3 Passos

### PASSO 1: Adicionar variáveis ao .env

Edite `/home/user/cinepremium-final/.env` e adicione:

```env
# Se for DomCloud/Produção:
NODE_ENV=production
REDIS_URL=redis://localhost:6379

# Se for apenas desenvolvimento com Redis:
# USE_REDIS=true
# REDIS_URL=redis://localhost:6379
```

**IMPORTANTE**: Em DomCloud, use `redis://localhost:6379` pois o Redis roda localmente.

---

### PASSO 2: Adicionar função initializeRedis()

No arquivo **server.js**, substitua as linhas **68-129** por:

```javascript
// CORREÇÃO: Configuração do cliente Redis para sessões persistentes
// Isso resolve problemas de vazamento de memória e permite scaling horizontal
let redisClient;
let sessionStore;

// NOVO: Função assíncrona para inicializar Redis
async function initializeRedis() {
  if (process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true') {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      console.log(`📦 Conectando ao Redis: ${redisUrl}`);

      redisClient = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('❌ Redis: Máximo de tentativas de reconexão atingido');
              return new Error('Máximo de tentativas de reconexão atingido');
            }
            const delay = Math.min(retries * 100, 3000);
            console.log(`🔄 Redis: Tentando reconectar em ${delay}ms (tentativa ${retries})`);
            return delay;
          }
        }
      });

      redisClient.on('error', (err) => {
        console.error('❌ Erro no Redis:', err);
      });

      redisClient.on('connect', () => {
        console.log('✅ Redis conectado com sucesso');
      });

      redisClient.on('ready', () => {
        console.log('✅ Redis pronto para uso');
      });

      // CRUCIAL: Aguarda a conexão ser estabelecida
      await redisClient.connect();

      // Cria sessionStore DEPOIS que Redis conectar
      sessionStore = new RedisStore({
        client: redisClient,
        prefix: 'cinepremium:sess:',
        ttl: 8 * 60 * 60 // 8 horas em segundos
      });
      console.log('✅ RedisStore configurado');

      return true;
    } catch (error) {
      console.error('❌ Erro ao configurar Redis:', error);
      console.warn('⚠️ Usando MemoryStore como fallback (NÃO RECOMENDADO EM PRODUÇÃO)');
      redisClient = null;
      sessionStore = null;
      return false;
    }
  } else {
    console.warn('⚠️ Usando MemoryStore para sessões (apenas desenvolvimento)');
    console.warn('💡 Para produção, configure NODE_ENV=production e REDIS_URL no .env');
    return true; // Continua mesmo sem Redis
  }
}

// NOVO: Configuração do middleware de sessão (MOVIDO PARA APÓS initializeRedis)
// Será chamado na função startServer() após Redis estar pronto
```

---

### PASSO 3: Modificar startServer() e registrar middleware

No arquivo **server.js**, substitua as linhas **1009-1033** por:

```javascript
const PORT = process.env.PORT || 3000;

// CORREÇÃO: Função de inicialização assíncrona
// Obtém Redis ANTES de registrar middlewares
async function startServer() {
  try {
    console.log('🚀 Inicializando servidor...');

    // PASSO 1: Aguarda Redis conectar (se configurado)
    console.log('📡 Inicializando armazenamento de sessões...');
    await initializeRedis();
    console.log('✅ Sessões configuradas');

    // PASSO 2: Registra middleware de sessão DEPOIS que Redis está pronto
    app.use(cookieParser());
    app.use(session({
      store: sessionStore,  // Agora tem valor!
      secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
      resave: false,
      saveUninitialized: false,
      name: 'sessionId',
      proxy: true,
      cookie: {
        maxAge: 8 * 60 * 60 * 1000, // 8 horas
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        domain: process.env.COOKIE_DOMAIN || undefined
      }
    }));

    // PASSO 3: Obtém token OndaPay
    console.log('📡 Obtendo token OndaPay...');
    await getOndaPayToken();
    console.log('✅ Token OndaPay obtido com sucesso');

    // PASSO 4: Inicia o servidor
    app.listen(PORT, () => {
      console.log(`✅ Servidor rodando na porta ${PORT}`);
      console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log('✨ Sistema pronto para receber requisições');
    });
  } catch (error) {
    console.error('❌ Erro ao inicializar servidor:', error);
    console.error('💥 O servidor não foi iniciado devido a erros críticos');
    process.exit(1);
  }
}

// Inicia o servidor
startServer();
```

---

## IMPORTANTE: Remover registros duplicados

Após as mudanças acima, **PROCURE E REMOVA** estas linhas que agora estão duplicadas:

**Procure por (linhas aproximadamente 132-148 na versão original):**
```javascript
// NOVO: Configuração do middleware de sessão
app.use(cookieParser());
app.use(session({
  store: sessionStore,
  ...
}));
```

**Estas linhas FORAM MOVIDAS para dentro de startServer()** e não devem ficar no lugar antigo!

---

## Verificação Pós-Correção

### 1. Teste a Configuração
```bash
npm run diagnose-redis
```

Deve mostrar:
```
4️⃣ Condição para usar Redis:
   Resultado: ✅ SIM
```

### 2. Inicie o Servidor
```bash
npm start
```

Deve mostrar na inicialização:
```
📦 Conectando ao Redis: redis://localhost:6379
✅ Redis conectado com sucesso
✅ Redis pronto para uso
✅ RedisStore configurado
✅ Sessões configuradas
✅ Servidor rodando na porta 3000
```

### 3. Teste a Sessão
```bash
npm run test-session-persistence
```

Ou manualmente:
```bash
# Faça login no admin
curl -c cookies.txt -X POST http://localhost:3000/auth \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=sua_senha"

# Verifique sessão no Redis
npm run test-redis redis://localhost:6379
```

### 4. Verifique Diagnóstico
```bash
curl -b "sessionId=sua_sessao" http://localhost:3000/api/diagnostics
```

Deve mostrar:
```json
{
  "redis": {
    "store_configured": true,
    "client_connected": true,
    "store_type": "RedisStore",
    "active_sessions": 1
  }
}
```

---

## Resumo das Mudanças

| Arquivo       | O Que Muda                                  | Motivo              |
|---------------|---------------------------------------------|---------------------|
| .env          | + NODE_ENV=production                       | Ativar Redis        |
|               | + REDIS_URL=redis://localhost:6379          | Configurar URL      |
| server.js     | Linhas 68-129: Nova função initializeRedis()| Aguardar Redis      |
|               | Linhas 132-148: Movidas para startServer()  | Eliminar race cond. |
|               | Linhas 1009-1033: Modificado startServer()  | Chamar initRedis()  |

---

## Se Algo Não Funcionar

### Erro: "Redis não está acessível"
```bash
# Verifique se Redis está rodando
redis-cli ping
# Deve retornar: PONG
```

### Erro: "Condição retorna NÃO"
```bash
# Verifique .env está correto
cat .env | grep "NODE_ENV\|REDIS_URL"
# Deve mostrar os dois valores
```

### Erro: "Sessions ainda em MemoryStore"
```bash
# Verifique se startServer() foi modificado
grep -n "await initializeRedis" server.js
# Deve mostrar a linha

# Verifique se linha 132-148 foi removida
grep -n "app.use(session" server.js
# Deve mostrar só uma linha (dentro de startServer)
```

---

## DomCloud Deployment

Se estiver usando DomCloud, edite o arquivo `domcloud.yml`:

```yaml
hooks:
  postdeploy: npm run migrate
app:
  python_version: none
  startup: npm start
env_var_list:
  - NODE_ENV=production
  - REDIS_URL=redis://localhost:6379
  - PORT=3000
  - SESSION_SECRET=sua_chave_secreta
  - ADMIN_USER=admin
  - ADMIN_PASS=sua_senha_hash
  - DB_HOST=sao.domcloud.co
  - DB_NAME=seu_banco
  - DB_USER=seu_usuario
  - DB_PASS=sua_senha
  - ONDAPAY_CLIENT_ID=seu_id
  - ONDAPAY_CLIENT_SECRET=seu_secret
  - WEBHOOK_URL=https://seu-dominio.com/ondapay-webhook
  - ONDAPAY_WEBHOOK_SECRET=seu_webhook_secret
  - FIREBASE_CREDENTIALS_BASE64=sua_base64
  - FIREBASE_API_KEY=sua_api_key
  - FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
  - FIREBASE_PROJECT_ID=seu-projeto-id
  - FIREBASE_STORAGE_BUCKET=seu-projeto.firebasestorage.app
  - FIREBASE_MESSAGING_SENDER_ID=seu_sender_id
  - FIREBASE_APP_ID=seu_app_id
  - FIREBASE_VAPID_KEY=sua_vapid_key
  - ALLOWED_ORIGINS=https://seu-dominio.com
```

---

## Documentação de Referência

- **Análise Detalhada**: `REDIS-SESSION-ANALYSIS.md`
- **Diagramas**: `REDIS-FLOWCHART.md`
- **Este Guia**: `REDIS-FIX-GUIDE.md`

