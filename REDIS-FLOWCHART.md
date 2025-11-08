# 🔄 Diagrama de Fluxo: Por Que Redis Não Funciona

## Diagrama 1: Fluxo de Execução ATUAL (❌ ERRADO)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     INICIALIZAÇÃO DO SERVIDOR                       │
└─────────────────────────────────────────────────────────────────────┘

┌─ Linha 2: require('dotenv').config() ─────────────────────────────┐
│  ✓ Carrega variáveis do .env                                      │
│  .env = { SESSION_SECRET, ADMIN_USER, ADMIN_PASS, DB_... }        │
│  .env = { ❌ NÃO TEM REDIS_URL }                                  │
│  .env = { ❌ NÃO TEM NODE_ENV='production' }                      │
│  .env = { ❌ NÃO TEM USE_REDIS='true' }                           │
└────────────────────────────────────────────────────────────────────┘

┌─ Linha 73: Verificação de Condição ───────────────────────────────┐
│  if (NODE_ENV === 'production' || USE_REDIS === 'true')           │
│                                                                     │
│  NODE_ENV = undefined (não definido)          ❌ FALSE            │
│  USE_REDIS = undefined (não definido)         ❌ FALSE            │
│                                                                     │
│  ❌ Condição é FALSE!                                             │
│  → Pula para o else na linha 126               ▼                  │
└────────────────────────────────────────────────────────────────────┘

┌─ Linha 126-128: Executa else (Redis desativado) ──────────────────┐
│  console.warn('⚠️ Usando MemoryStore para sessões (apenas desenv'  │
│                                                                     │
│  redisClient = undefined (nunca foi criado)                        │
│  sessionStore = undefined (nunca foi criado)                       │
└────────────────────────────────────────────────────────────────────┘

┌─ Linha 132-148: Cria middleware de sessão ─────────────────────────┐
│  app.use(cookieParser())                                           │
│  app.use(session({                                                 │
│    store: sessionStore,    ← undefined!                            │
│    secret: "...",                                                  │
│    resave: false,                                                  │
│    saveUninitialized: false,                                       │
│    ...                                                              │
│  }))                                                                │
│                                                                     │
│  → Express vê store=undefined                                      │
│  → Express usa sua implementação padrão: MemoryStore! ⚠️           │
└────────────────────────────────────────────────────────────────────┘

┌─ Linhas 150-1033: Resto da inicialização ──────────────────────────┐
│  Firebase, CORS, Rate Limiting, Rotas, etc...                      │
│  (todas as outras coisas funcionam normalmente)                    │
└────────────────────────────────────────────────────────────────────┘

┌─ Linhas 1013-1033: startServer() ──────────────────────────────────┐
│  app.listen(PORT, ...)                                             │
│  ✅ Servidor inicia                                                │
│  ❌ Mas usando MemoryStore para sessões!                          │
└────────────────────────────────────────────────────────────────────┘

RESULTADO FINAL:
┌──────────────────────────────────────────────────────┐
│  Servidor rodando com MemoryStore                    │
│  ❌ Sessions NÃO persistem em Redis                  │
│  ❌ Sessions perdidas ao restart                    │
│  ❌ Múltiplas instâncias não compartilham            │
│  ❌ Vazamento de memória progressivo                │
└──────────────────────────────────────────────────────┘
```

---

## Diagrama 2: Fluxo Problemático (SE configurado, ainda assim falha)

```
Suponha que fossemos adicionar ao .env:
  NODE_ENV=production
  REDIS_URL=redis://localhost:6379

TEMPO  STACK                              sessionStore STATE
────  ──────────────────────────────────  ──────────────────
T0    Linha 73: if ✓ TRUE                 undefined
      redisClient = createClient()        undefined

T1    Linha 106: redisClient.connect()    undefined
      ↓ Promise criada, mas SEM await!    ↓
      (Promise vai rodar DEPOIS)          Vai ficar undefined

T2    Linha 132: app.use(cookieParser())  undefined
      Linha 133: app.use(session({        undefined
        store: sessionStore  ← undefined! ↓
        ...
      }))
      ↓ Middleware registrado com store=undefined
      ↓ Express usa MemoryStore automaticamente!
      ❌ PROBLEMA ENCONTRADO!             undefined

T3    Linha 1023: app.listen(PORT)        undefined
      ✅ Servidor começou a receber requisições
      ❌ Mas sem RedisStore!               undefined

T4    (alguns ms depois, assincronamente) undefined
      Promise do .then() finalmente executa
      ↓

T5    Linha 109: sessionStore = new RedisStore({...})  ✅ CRIADO
      Mas é TOO LATE!
      ↓ Middleware já foi registrado!
      ↓ Não há como mudar o store depois!

CONSEQUÊNCIA:
┌──────────────────────────────────────────┐
│ Mesmo com as variáveis corretas,         │
│ a race condition FAZ COM QUE Redis       │
│ não seja usado!                           │
└──────────────────────────────────────────┘
```

---

## Diagrama 3: Sequência de Execução SÍNCRONO vs ASSÍNCRONO

```
❌ CÓDIGO ATUAL (NÃO AGUARDA REDIS)
═══════════════════════════════════════════════════════

EXECUÇÃO SÍNCRONA:
┌──────────────────────────┐
│ Linha 73: if ✓           │
│ Linha 106: connect() ────┼─ Cria Promise
│ (não aguarda)            │  (vai executar depois)
│ Linha 133: session() ────┼─ Registra middleware
│ (sessionStore ainda é    │  com store=undefined
│  undefined)              │
│ Linha 1023: listen() ────┼─ Inicia servidor
└──────────────────────────┘
              │
              ├─ MAIS ADIANTE, ASSINCRONAMENTE:
              │  Linha 109: sessionStore = new RedisStore({...})
              │  ❌ MAS O MIDDLEWARE JÁ FOI REGISTRADO!
              │

═════════════════════════════════════════════════════════

✅ CÓDIGO CORRETO (AGUARDA REDIS)
═════════════════════════════════════════════════════════

FUNÇÃO ASYNC:
async function startServer() {
  // PASSO 1: Aguarda Redis conectar
  await initializeRedis()  ◄─ sessionStore agora é definido!
  
  // PASSO 2: Registra middleware
  app.use(session({
    store: sessionStore  ◄─ ✅ Agora tem um valor!
  }))
  
  // PASSO 3: Inicia servidor
  app.listen(PORT)
}

EXECUÇÃO:
┌────────────────────────────────────────────┐
│ Função startServer() inicia                │
│ │                                           │
│ ├─ await initializeRedis()                 │
│ │  ├─ createClient()                       │
│ │  ├─ await redisClient.connect() ◄────── AGUARDA!
│ │  ├─ sessionStore = new RedisStore({...})│
│ │  └─ return                               │
│ │                                           │
│ ├─ app.use(session({ store: sessionStore }))
│ │  ✅ sessionStore agora tem valor!        │
│ │                                           │
│ └─ app.listen(PORT)                        │
│    ✅ Servidor inicia com RedisStore!      │
└────────────────────────────────────────────┘
```

---

## Diagrama 4: Estado do redisClient e sessionStore ao Longo do Tempo

```
CENÁRIO 1: ATUAL (❌ ERRADO)
═════════════════════════════════════════════

TEMPO    redisClient        sessionStore       AÇÃOSERVING USERS?
────────────────────────────────────────────────────────────────────
T0       null               undefined          (inicialização)
T1       null               undefined          (else executado)
T2       null               undefined          session() middleware registrado
T3       null               undefined          app.listen() ← COMEÇA SERVIR
T4       (connecting...)    undefined          ❌ Usuários logam em MemoryStore
T5       (connected)        undefined          ❌ Sessões em memória volátil
T6       ready              RedisStore         ❌ Middleware já usa MemoryStore
T7       connected          RedisStore         ❌ Sessions em memória, não em Redis


CENÁRIO 2: CORRETO (✅ CORRETO)
═════════════════════════════════════════════

TEMPO    redisClient        sessionStore       AÇÃO                SERVING USERS?
────────────────────────────────────────────────────────────────────────────────
T0       null               undefined          startServer() inicia
T1       (creating...)      undefined          initializeRedis() inicia
T2       (creating...)      undefined          createClient()
T3       (connecting...)    undefined          await connect() ← AGUARDA
T4       (connected)        undefined          (aguardando ainda)
T5       ready              undefined          (aguardando ainda)
T6       ready              RedisStore         ← CRIA sessionStore
T7       ready              RedisStore         session() middleware registrado
T8       ready              RedisStore         app.listen() ← COMEÇA SERVIR
T9       ready              RedisStore         ✅ Usuários logam em RedisStore
T10      ready              RedisStore         ✅ Sessions persistem em Redis!
```

---

## Diagrama 5: Fluxo de Decisão

```
ENTRADA: Aplicação inicia

│
├─ Carrega .env
│  ├─ NODE_ENV está definido como 'production'?
│  │  │
│  │  ├─ SIM → Ir para "USAR REDIS"
│  │  │
│  │  └─ NÃO → Próxima condição
│  │     │
│  │     └─ USE_REDIS está definido como 'true'?
│  │        │
│  │        ├─ SIM → Ir para "USAR REDIS"
│  │        │
│  │        └─ NÃO → Ir para "USAR MEMORYSTORE"
│  │
│  └─ USAR REDIS:
│     ├─ REDIS_URL está definido?
│     │  ├─ SIM → Usar REDIS_URL do .env
│     │  └─ NÃO → Usar default 'redis://localhost:6379'
│     │
│     ├─ redisClient = createClient()
│     ├─ await redisClient.connect()  ◄─ AGUARDA!
│     ├─ sessionStore = new RedisStore()
│     └─ Middleware registrado com RedisStore
│     │
│     └─ Resultado: ✅ Sessions em Redis
│
└─ USAR MEMORYSTORE:
   ├─ Skipa lógica de Redis completamente
   ├─ sessionStore = undefined
   ├─ Middleware registrado com store=undefined
   │
   └─ Resultado: ❌ Sessions em memória volátil
```

---

## Diagrama 6: Comparação de Comportamento

```
╔════════════════════════════════════════════════════════════════╗
║         MEMORYSTORE (❌ Atual)  vs  REDISSTORE (✅ Correto)   ║
╠════════════════════════════════════════════════════════════════╣
║ ASPECTO                MEMORYSTORE        REDISSTORE           ║
╠════════════════════════════════════════════════════════════════╣
║ Persistência           ❌ Volátil         ✅ Persistente       ║
║                        (perde ao restart) (mantém dados)       ║
║                                                                 ║
║ Compartilhado entre    ❌ NÃO             ✅ SIM               ║
║ instâncias             (per-process)      (compartilhado)      ║
║                                                                 ║
║ Escalabilidade         ❌ NÃO             ✅ SIM               ║
║ Horizontal             (não funciona)     (funciona)           ║
║                                                                 ║
║ Vazamento de Memória   ❌ ALTO            ✅ BAIXO             ║
║ (memory leak)          (crescente)        (controlado por TTL) ║
║                                                                 ║
║ Restart Server         ❌ Sessions        ✅ Sessions mantidas ║
║                        são perdidas                             ║
║                                                                 ║
║ Logout Surpresa        ❌ COMUM           ✅ RARO              ║
║ (usuário deslogado)    (Passenger        (apenas se            ║
║                        reinicia app)     expira TTL)           ║
║                                                                 ║
║ Produção (DomCloud)    ❌ FALHA           ✅ FUNCIONA           ║
║                        (muito crítico)   (recomendado)        ║
╚════════════════════════════════════════════════════════════════╝
```

---

## Diagrama 7: Onde Os Problemas Ocorrem em server.js

```
server.js
═════════════════════════════════════════════════════════════════

Linhas 1-67:     Imports e Setup Express
                 ✅ OK

Linhas 68-71:    Declaração de variáveis Redis
                 ✅ OK (let redisClient; let sessionStore;)

Linhas 73-129:   ❌ PROBLEMA 1: Configuração Redis
                 │
                 ├─ Linha 73: Condição de ativação
                 │  if (NODE_ENV === 'production' || USE_REDIS === 'true')
                 │  ❌ Retorna FALSE (variáveis não estão configuradas)
                 │
                 ├─ Linhas 74-125: Código Redis IGNORADO
                 │  (não executa porque condição é FALSE)
                 │
                 └─ Linhas 126-128: Else executado
                    console.warn('⚠️ Usando MemoryStore')
                    sessionStore = undefined

Linhas 132-148:  ❌ PROBLEMA 2: Middleware de Sessão
                 │
                 ├─ Linha 133: app.use(session({
                 │  store: sessionStore  ← undefined!
                 │  ...
                 │  }))
                 │
                 └─ Express usa MemoryStore implicitamente

Linhas 150-1009: Resto das rotas e middleware
                 ✅ OK (não afeta sessões)

Linhas 1011-1033: ❌ PROBLEMA 3: startServer()
                  │
                  └─ Não aguarda Redis conectar antes de
                     registrar middleware e iniciar servidor
                     (o problema já existe na linha 106 também)

═════════════════════════════════════════════════════════════════
```

---

## Resumo Visual: O Que Precisa Ser Feito

```
┌───────────────────────────────────────────────────────────────┐
│                    PARA CORRIGIR O PROBLEMA                   │
├───────────────────────────────────────────────────────────────┤
│                                                                 │
│ 1️⃣ CONFIGURAÇÃO (.env)                                        │
│    ─────────────────────────────────────────────────          │
│    Adicionar:                                                   │
│    NODE_ENV=production                                         │
│    REDIS_URL=redis://seu-redis-host:6379                      │
│                                                                 │
│    ou                                                           │
│                                                                 │
│    USE_REDIS=true                                              │
│    REDIS_URL=redis://localhost:6379                           │
│                                                                 │
│ 2️⃣ CÓDIGO (server.js)                                         │
│    ────────────────────────────────────────────────           │
│    Criar função initializeRedis() async que:                   │
│    ├─ Cria redisClient                                         │
│    ├─ await redisClient.connect() ◄────── CRUCIAL!            │
│    ├─ sessionStore = new RedisStore()                          │
│    └─ Retorna quando pronto                                    │
│                                                                 │
│ 3️⃣ INICIALIZAÇÃO (startServer)                                │
│    ─────────────────────────────────────────────             │
│    Modificar para:                                              │
│    async function startServer() {                               │
│      await initializeRedis() ◄──── CRUCIAL!                    │
│      app.use(session(...))  ◄──── Agora sessionStore ok       │
│      app.listen(PORT)       ◄──── Inicia servidor              │
│    }                                                            │
│                                                                 │
└───────────────────────────────────────────────────────────────┘
```

