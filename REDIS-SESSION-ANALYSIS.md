# 🔴 ANÁLISE COMPLETA: Sessões NÃO Estão Sendo Armazenadas no Redis

## RESUMO EXECUTIVO
A aplicação **NÃO está usando Redis** para armazenar sessões, em vez disso está usando **MemoryStore** (memória volatile). Existem **3 problemas críticos**:

1. **Configuração do .env faltando** - REDIS_URL não está definido
2. **Condição NODE_ENV não atende** - NODE_ENV não é 'production' e USE_REDIS não é 'true'
3. **Race condition assíncrona** - Mesmo se configurado, a race condition impediria que funcionasse

---

## 📋 PROBLEMA 1: Variáveis de Ambiente Faltando

### Situação Atual (❌ ERRADO)
```
.env arquivo ATUAL:
  ❌ REDIS_URL não está definido
  ❌ NODE_ENV não está definido (assume 'development')
  ❌ USE_REDIS não está definido
```

### Por Que Não Funciona
No arquivo **server.js, linha 73**:
```javascript
if (process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true') {
  // Código de inicialização do Redis (linhas 74-125)
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    // ... cria redisClient e sessionStore ...
  }
} else {
  // ⚠️ ESTE BLOCO É EXECUTADO (linha 126-128)
  console.warn('⚠️ Usando MemoryStore para sessões (apenas desenvolvimento)');
}
```

**Resultado**: A condição retorna `FALSE`, então o código Redis é **COMPLETAMENTE IGNORADO**. A aplicação vai direto para o `else` na linha 126.

### Confirmação do Diagnóstico
```
$ npm run diagnose-redis

1️⃣ Variável REDIS_URL:
   ❌ NÃO definida

2️⃣ NODE_ENV:
   não definido (padrão: development)

3️⃣ USE_REDIS:
   não definido

4️⃣ Condição para usar Redis:
   (NODE_ENV === 'production' || USE_REDIS === 'true')
   Resultado: ❌ NÃO

⚠️  PROBLEMA ENCONTRADO:
   A aplicação NÃO vai usar Redis com as configurações atuais!
```

---

## 📋 PROBLEMA 2: Race Condition Assíncrona (MESMO SE CONFIGURADO)

### O Problema
Mesmo que as variáveis de ambiente fossem configuradas corretamente, **uma race condition impediria que Redis funcionasse**.

### Sequência de Execução Atual (❌ ERRADA)

```
TEMPO    |  CÓDIGO                                    |  ESTADO DE sessionStore
---------|--------------------------------------------|--------------------------
T0       |  redisClient = createClient(...)           |  undefined
T1       |  redisClient.connect()  ← Promise criada   |  undefined
         |  ↓                                         |
T2       |  app.use(session({                         |  ⚠️ AINDA undefined!
         |    store: sessionStore,  ← Passado null   |  Middleware registrado
         |    ...                                     |  com sessionStore=null
         |  }))                                       |
T3       |  ↓ (código síncrono continua)             |  undefined
         |  (mais rotas e middlewares...)            |
T4       |  app.listen(PORT)                         |  undefined
         |                                            |
T5       |  (depois, assincronamente)                |
         |  .then(() => {                            |
T6       |    sessionStore = new RedisStore(...)     |  ✅ MAS É MUITO TARDE!
         |    console.log('✅ RedisStore configurado')|  Middleware já registrado
         |  })                                        |
```

### O Que Acontece na Prática

1. **Linha 106**: `redisClient.connect()` é chamado SEM `await`
2. **Linha 133**: `app.use(session({...}))` é executado IMEDIATAMENTE
3. Neste ponto, `sessionStore` é `undefined`
4. Express vê `store: undefined` e **usa sua implementação padrão: MemoryStore**
5. Só **depois**, assincronamente, o Redis conecta e cria o RedisStore (linhas 109-113)
6. Mas é **muito tarde** - o middleware já foi registrado!

### Código Problemático (server.js, linhas 106-148)

```javascript
// ❌ PROBLEMA: Não usa await
redisClient.connect()
  .then(() => {
    // Cria sessionStore DEPOIS que Redis conectar
    sessionStore = new RedisStore({
      client: redisClient,
      prefix: 'cinepremium:sess:',
      ttl: 8 * 60 * 60
    });
    console.log('✅ RedisStore configurado');
  })
  .catch(err => {
    console.error('❌ Falha ao conectar ao Redis:', err);
    sessionStore = null;
  });

// ❌ PROBLEMA: Executado IMEDIATAMENTE (síncrono)
app.use(session({
  store: sessionStore, // ❌ undefined neste ponto!
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
  resave: false,
  saveUninitialized: false,
  name: 'sessionId',
  proxy: true,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined
  }
}));
```

---

## 📋 PROBLEMA 3: Falta de await na Função startServer()

### Código Problemático (server.js, linhas 1011-1033)

```javascript
async function startServer() {
  try {
    console.log('🚀 Inicializando servidor...');

    // Obtém token OndaPay antes de aceitar requisições
    console.log('📡 Obtendo token OndaPay...');
    await getOndaPayToken();  // ✅ Aguarda OndaPay
    console.log('✅ Token OndaPay obtido com sucesso');

    // ❌ PROBLEMA: Não aguarda Redis conectar!
    app.listen(PORT, () => {
      console.log(`✅ Servidor rodando na porta ${PORT}`);
      console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log('✨ Sistema pronto para receber requisições');
    });
  } catch (error) {
    console.error('❌ Erro ao inicializar servidor:', error);
    process.exit(1);
  }
}
```

**Problema**: A função aguarda OndaPay se conectar (linha 1019), mas **não aguarda Redis se conectar**!

---

## 🔍 VERIFICAÇÃO NO ENDPOINT /api/diagnostics

Quando você chama `/api/diagnostics`, a resposta mostra:

```javascript
redis: {
  url_configured: false,         // ❌ REDIS_URL não está definido
  client_connected: false,       // ❌ redisClient é null
  store_configured: false,       // ❌ sessionStore é undefined
  should_use_redis: false        // ❌ NODE_ENV !== 'production' && USE_REDIS !== 'true'
},
session: {
  store_type: 'MemoryStore'      // ⚠️ USANDO MEMORYSTORE, NÃO REDISSTORE!
}
```

---

## 🚨 IMPACTOS NA PRODUÇÃO

### Se em Desenvolvimento
- ✅ Funciona OK com MemoryStore
- ⚠️ Mas não persiste sessões entre restarts

### Se em Produção (DomCloud)
- 🔴 **Crítico**: Sessions são perdidas quando o Passenger reinicia
- 🔴 **Crítico**: Usuários deslogam inesperadamente
- 🔴 **Crítico**: Múltiplas instâncias não compartilham sessões
- 🔴 **Crítico**: Consumo de memória aumenta continuamente (vazamento)

---

## ✅ SOLUÇÃO COMPLETA

### Passo 1: Configurar Variáveis de Ambiente no .env

Adicione ao seu `.env`:

```env
# Ative Redis - escolha UMA das opções abaixo:

# OPÇÃO 1: Em produção (DomCloud, Heroku, etc)
NODE_ENV=production
REDIS_URL=redis://seu-redis-host:6379

# OPÇÃO 2: Em desenvolvimento, force uso de Redis
USE_REDIS=true
REDIS_URL=redis://localhost:6379
```

### Passo 2: Corrigir a Race Condition em server.js

**ANTES (❌ ERRADO - linhas 73-148)**:
```javascript
if (process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true') {
  try {
    redisClient = createClient({...});
    
    // ❌ Não aguarda!
    redisClient.connect()
      .then(() => {
        sessionStore = new RedisStore({...});
      });
  } catch (error) {...}
}

// ❌ Executado imediatamente com sessionStore = undefined
app.use(session({
  store: sessionStore,  // ❌ undefined aqui!
  ...
}));
```

**DEPOIS (✅ CORRETO)**:
```javascript
let redisClient;
let sessionStore;

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

      // ✅ AGUARDA a conexão!
      await redisClient.connect();
      
      // ✅ Agora sim cria o sessionStore
      sessionStore = new RedisStore({
        client: redisClient,
        prefix: 'cinepremium:sess:',
        ttl: 8 * 60 * 60
      });
      console.log('✅ RedisStore configurado');

    } catch (error) {
      console.error('❌ Erro ao configurar Redis:', error);
      console.warn('⚠️ Usando MemoryStore como fallback (NÃO RECOMENDADO EM PRODUÇÃO)');
      redisClient = null;
      sessionStore = null;
    }
  } else {
    console.warn('⚠️ Usando MemoryStore para sessões (apenas desenvolvimento)');
    console.warn('💡 Para produção, configure NODE_ENV=production e REDIS_URL no .env');
  }
}

// ✅ Configure o middleware DEPOIS que Redis estiver pronto
app.use(cookieParser());
app.use(session({
  store: sessionStore,  // ✅ Agora estará definido corretamente
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-this',
  resave: false,
  saveUninitialized: false,
  name: 'sessionId',
  proxy: true,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined
  }
}));

// ✅ Inicialize o servidor DEPOIS que Redis estiver pronto
async function startServer() {
  try {
    console.log('🚀 Inicializando servidor...');
    
    // ✅ Aguarda Redis conectar
    console.log('📡 Inicializando Redis...');
    await initializeRedis();
    console.log('✅ Redis pronto');

    // ✅ Aguarda OndaPay
    console.log('📡 Obtendo token OndaPay...');
    await getOndaPayToken();
    console.log('✅ Token OndaPay obtido');

    // ✅ Agora sim inicia o servidor
    app.listen(PORT, () => {
      console.log(`✅ Servidor rodando na porta ${PORT}`);
      console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log('✨ Sistema pronto para receber requisições');
    });
  } catch (error) {
    console.error('❌ Erro ao inicializar servidor:', error);
    process.exit(1);
  }
}

startServer();
```

### Passo 3: Em DomCloud, Configure no YAML

```yaml
hooks:
  postdeploy: |
    npm run migrate
app:
  python_version: none
  startup: npm start
env_var_list:
  - NODE_ENV=production
  - REDIS_URL=redis://localhost:6379
  - PORT=3000
  - SESSION_SECRET=sua_chave_secreta_aqui
  # ... outras variáveis ...
```

---

## 🧪 VERIFICAR SE ESTÁ FUNCIONANDO

### 1. Teste a Conexão Redis
```bash
npm run test-redis redis://seu-host:6379
```

### 2. Verifique Configuração
```bash
npm run diagnose-redis
```

Deve mostrar:
```
✅ SIM (ao invés de ❌ NÃO)
```

### 3. Faça Login e Verifique Sessões
```bash
npm run test-session-persistence
```

### 4. Endpoint de Diagnóstico
```bash
curl -b cookies.txt http://localhost:3000/api/diagnostics
```

Deve mostrar:
```json
{
  "redis": {
    "store_configured": true,
    "client_connected": true,
    "store_type": "RedisStore"
  },
  "session": {
    "store_type": "RedisStore"
  }
}
```

---

## 📊 Resumo dos Problemas e Soluções

| Problema | Causa | Solução |
|----------|-------|--------|
| REDIS_URL não definido | .env não configurado | Adicionar REDIS_URL ao .env |
| NODE_ENV não é 'production' | Ambiente de desenvolvimento | Definir NODE_ENV=production em produção |
| USE_REDIS não é 'true' | Flag não ativada | Definir USE_REDIS=true ou NODE_ENV=production |
| sessionStore = undefined | Race condition assíncrona | Usar `await` para aguardar Redis conectar antes de registrar middleware |
| Sessions perdidas ao restart | MemoryStore sendo usado | Garantir que sessionStore seja RedisStore antes do middleware |

---

## 🔗 Referências

- **Arquivo Principal**: `/home/user/cinepremium-final/server.js`
  - Linhas 68-148: Configuração do Redis (PROBLEMÁTICO)
  - Linha 73: Condição que ativa Redis
  - Linhas 106-121: Race condition assíncrona
  - Linhas 133-148: Middleware de sessão
  - Linhas 1011-1033: Função startServer

- **Arquivos de Diagnóstico**:
  - `/home/user/cinepremium-final/diagnose-redis.js`: Verifica configuração
  - `/home/user/cinepremium-final/test-redis-connection.js`: Testa conexão

- **Configuração**:
  - `/home/user/cinepremium-final/.env`: Variáveis de ambiente (INCOMPLETO)
  - `/home/user/cinepremium-final/.env.example`: Exemplo de configuração

