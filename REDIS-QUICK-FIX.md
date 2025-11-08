# 🚀 QUICK FIX: Habilitar Redis em 5 Minutos

## Checklist de Implementação

### ☑️ STEP 1: Atualizar .env (30 segundos)

```bash
# Edite .env e adicione estas linhas:
NODE_ENV=production
REDIS_URL=redis://localhost:6379

# Verifique:
cat .env | grep "NODE_ENV\|REDIS_URL"
# Deve mostrar os dois valores
```

### ☑️ STEP 2: Atualizar server.js (1 minuto)

**Localize a linha 73** com:
```javascript
if (process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true') {
```

**Substitua TODA a seção linhas 68-129** por este código:

```javascript
// CORREÇÃO: Configuração do cliente Redis para sessões persistentes
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
        ttl: 8 * 60 * 60
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
    return true;
  }
}
```

### ☑️ STEP 3: Remover middleware antigo (30 segundos)

**Localize as linhas 132-148** (aproximadamente):
```javascript
// NOVO: Configuração do middleware de sessão
app.use(cookieParser());
app.use(session({
  store: sessionStore,
  // ... resto da config ...
}));
```

**DELETE ESTAS LINHAS COMPLETAMENTE** - elas foram movidas para startServer()

### ☑️ STEP 4: Atualizar startServer() (1 minuto)

**Substitua TODA a seção linhas 1009-1033** por:

```javascript
const PORT = process.env.PORT || 3000;

// CORREÇÃO: Função de inicialização assíncrona
async function startServer() {
  try {
    console.log('🚀 Inicializando servidor...');

    // PASSO 1: Aguarda Redis conectar
    console.log('📡 Inicializando armazenamento de sessões...');
    await initializeRedis();
    console.log('✅ Sessões configuradas');

    // PASSO 2: Registra middleware de sessão DEPOIS que Redis está pronto
    app.use(cookieParser());
    app.use(session({
      store: sessionStore,
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
    process.exit(1);
  }
}

// Inicia o servidor
startServer();
```

### ☑️ STEP 5: Verificar mudanças (1 minuto)

```bash
# Teste 1: Diagnóstico
npm run diagnose-redis
# Deve mostrar: Resultado: ✅ SIM

# Teste 2: Sintaxe JS
npm start
# Se iniciar sem erros, está correto
# Pressione Ctrl+C para parar

# Teste 3: Verificar Redis
npm run test-redis redis://localhost:6379
# Deve conectar com sucesso
```

---

## Sumário das Mudanças

```
📝 ARQUIVO: .env
└─ ADICIONAR:
   NODE_ENV=production
   REDIS_URL=redis://localhost:6379

📝 ARQUIVO: server.js
├─ SUBSTITUIR linhas 68-129 por initializeRedis()
├─ DELETAR linhas 132-148 (middleware duplicado)
└─ SUBSTITUIR linhas 1009-1033 por novo startServer()
```

---

## Linhas Específicas para Editar em server.js

| Ação | Linhas | O Quê |
|------|--------|-------|
| Substituir | 68-129 | Adicionar função `initializeRedis()` |
| Deletar | 132-148 | Remover middleware duplicado `app.use(session(...))` |
| Substituir | 1009-1033 | Atualizar `startServer()` |

---

## Verificação de Sucesso

Após implementar, você deve ver nos logs:

```
🚀 Inicializando servidor...
📡 Inicializando armazenamento de sessões...
📦 Conectando ao Redis: redis://localhost:6379
✅ Redis conectado com sucesso
✅ Redis pronto para uso
✅ RedisStore configurado
✅ Sessões configuradas
📡 Obtendo token OndaPay...
✅ Token OndaPay obtido com sucesso
✅ Servidor rodando na porta 3000
🌍 Ambiente: production
✨ Sistema pronto para receber requisições
```

---

## Se Falhar

### Erro: "Cannot find redisClient"
→ Verifique se `let redisClient;` está declarado antes de `initializeRedis()`

### Erro: "sessionStore is undefined"
→ Verifique se deletou o middleware antigo (linhas 132-148)

### Erro: "REDIS_URL not defined"
→ Adicione `REDIS_URL=redis://localhost:6379` ao .env

### Erro de Sintaxe
→ Verifique se copiou o código inteiro sem cortar no meio

---

## Próximos Passos

1. ✅ Implemente os 5 passos acima
2. ✅ Teste localmente: `npm start`
3. ✅ Faça login e verifique: `/api/diagnostics`
4. ✅ Deploy em DomCloud
5. ✅ Teste em produção

---

## Documentação

- **Este arquivo**: Quick fix em 5 minutos
- `REDIS-ISSUE-SUMMARY.md`: Resumo dos problemas
- `REDIS-SESSION-ANALYSIS.md`: Análise detalhada
- `REDIS-FLOWCHART.md`: Diagramas
- `REDIS-FIX-GUIDE.md`: Guia completo

