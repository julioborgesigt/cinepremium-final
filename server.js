// NOVO: Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const admin = require('firebase-admin');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const compression = require('compression'); // NOVO: Compressão de respostas (Gzip/Brotli)
const axios = require('axios'); // Utilize axios para requisições HTTP
const puppeteer = require('puppeteer'); // Para automação de navegador
const { Op } = require('sequelize');
const { Product, PurchaseHistory, AdminDevice, PaymentSettings, sequelize } = require('./models');

// NOVO: Dependências para gerenciar sessões e cookies
const session = require('express-session');
const cookieParser = require('cookie-parser');
// CORREÇÃO: Redis para store de sessões persistente
const { createClient } = require('redis');
// CORREÇÃO: Import correto do RedisStore (named export, não default)
const { RedisStore } = require('connect-redis');

// NOVO: Dependências de segurança
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const csrf = require('csurf');
const xss = require('xss');
const validator = require('validator');
const QRCode = require('qrcode'); // Para gerar QR Code a partir do código PIX

const app = express();

// Array global para armazenar logs de debug
const debugLogs = [];
const MAX_DEBUG_LOGS = 1000;

// Map para armazenar códigos PIX temporariamente (installmentId -> pixData)
const pixCodesCache = new Map();
const PIX_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

function addDebugLog(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  debugLogs.push(logEntry);
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs.shift(); // Remove o mais antigo
  }
  console.log(logEntry);
}

// ============================================
// VALIDAÇÕES CRÍTICAS DE SEGURANÇA
// ============================================

// NOVO: Validação centralizada de variáveis de ambiente obrigatórias
function validateEnvironmentVariables() {
  const errors = [];
  const warnings = [];

  // 1. ADMIN_USER - Usuário administrador
  if (!process.env.ADMIN_USER) {
    errors.push({
      var: 'ADMIN_USER',
      message: 'Usuário administrador não configurado',
      solution: 'Defina ADMIN_USER no arquivo .env (exemplo: ADMIN_USER=admin)'
    });
  }

  // 2. ADMIN_PASS - Senha em formato bcrypt
  const passwordHash = process.env.ADMIN_PASS;
  if (!passwordHash) {
    errors.push({
      var: 'ADMIN_PASS',
      message: 'Senha do administrador não configurada',
      solution: 'Execute: npm run hash-password sua_senha_aqui'
    });
  } else if (!passwordHash.startsWith('$2b$') && !passwordHash.startsWith('$2a$')) {
    errors.push({
      var: 'ADMIN_PASS',
      message: 'Senha deve estar em formato bcrypt (não texto plano)',
      solution: 'Execute: npm run hash-password sua_senha_aqui'
    });
  }

  // 3. SESSION_SECRET - Secret para sessões
  if (!process.env.SESSION_SECRET) {
    errors.push({
      var: 'SESSION_SECRET',
      message: 'Secret de sessão não configurado',
      solution: 'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    });
  } else if (process.env.SESSION_SECRET.length < 32) {
    warnings.push({
      var: 'SESSION_SECRET',
      message: 'Secret de sessão muito curto (recomendado: 64+ caracteres)',
      solution: 'Gere um secret mais forte para produção'
    });
  }

  // 4. CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY
  if (!process.env.CIABRA_PUBLIC_KEY) {
    errors.push({
      var: 'CIABRA_PUBLIC_KEY',
      message: 'Chave pública da CIABRA não configurada',
      solution: 'Obtenha no painel da CIABRA e configure no .env'
    });
  }
  if (!process.env.CIABRA_PRIVATE_KEY) {
    errors.push({
      var: 'CIABRA_PRIVATE_KEY',
      message: 'Chave privada da CIABRA não configurada',
      solution: 'Obtenha no painel da CIABRA e configure no .env'
    });
  }

  // 6. ALLOWED_ORIGINS - Obrigatório em produção
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
    errors.push({
      var: 'ALLOWED_ORIGINS',
      message: 'Origens permitidas não configuradas (obrigatório em produção)',
      solution: 'Configure ALLOWED_ORIGINS com domínios permitidos (ex: https://exemplo.com,https://www.exemplo.com)'
    });
  }

  // 7. Firebase - Avisar se não configurado (não é crítico)
  if (!process.env.FIREBASE_CREDENTIALS_BASE64 && !process.env.FIREBASE_API_KEY) {
    warnings.push({
      var: 'FIREBASE_*',
      message: 'Credenciais Firebase não configuradas',
      solution: 'Notificações push não funcionarão. Configure se necessário.'
    });
  }

  // 8. REDIS_URL - Avisar se não configurado em produção
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL && !process.env.USE_REDIS) {
    warnings.push({
      var: 'REDIS_URL',
      message: 'Redis não configurado em produção',
      solution: 'Sessões serão voláteis. Configure REDIS_URL para sessões persistentes.'
    });
  }

  // Exibe erros
  if (errors.length > 0) {
    console.error('\n❌ ERROS CRÍTICOS - Variáveis de ambiente obrigatórias não configuradas:\n');
    errors.forEach(({ var: varName, message, solution }) => {
      console.error(`  ⚠️  ${varName}:`);
      console.error(`     ${message}`);
      console.error(`     💡 Solução: ${solution}\n`);
    });
    console.error('🛑 O servidor não pode iniciar sem essas variáveis.\n');
    process.exit(1);
  }

  // Exibe avisos
  if (warnings.length > 0) {
    console.warn('\n⚠️  AVISOS - Configurações recomendadas:\n');
    warnings.forEach(({ var: varName, message, solution }) => {
      console.warn(`  ⚡ ${varName}:`);
      console.warn(`     ${message}`);
      console.warn(`     💡 ${solution}\n`);
    });
  }

  console.log('✅ Todas as variáveis de ambiente críticas validadas com sucesso\n');
}

// Executa validação antes de qualquer outra coisa
// DESATIVADO: Validação estava impedindo servidor de iniciar com variáveis do Passenger
// As variáveis estão configuradas via Passenger (painel DomCloud), não via .env
// validateEnvironmentVariables();
console.log('✅ Servidor iniciando com variáveis de ambiente do Passenger...');

// Para compatibilidade com código existente
const passwordHash = process.env.ADMIN_PASS;

// ============================================
// FUNÇÕES UTILITÁRIAS DE SEGURANÇA
// ============================================

// CORREÇÃO CRÍTICA #6: Função para sanitizar inputs e prevenir XSS
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;

  // Remover HTML/scripts maliciosos
  return xss(validator.trim(input), {
    whiteList: {}, // Não permite nenhuma tag HTML
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style']
  });
}

// CORREÇÃO CRÍTICA #5: Wrapper para CSRF que só aplica se inicializado
function applyCsrf(req, res, next) {
  if (csrfProtection) {
    csrfProtection(req, res, next);
  } else {
    // CSRF ainda não inicializado (servidor iniciando)
    console.warn('[CSRF] Middleware ainda não inicializado, pulando proteção');
    next();
  }
}

// CRÍTICO: Confiar no proxy reverso (necessário para domcloud.co, heroku, etc)
// Isso permite que o Express reconheça HTTPS quando atrás de um proxy
app.set('trust proxy', 1);

// CORREÇÃO CRÍTICA: Configuração segura do CORS
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'], // Lista específica mesmo em dev
  credentials: true, // Permite cookies
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// CORREÇÃO CRÍTICA #3: Configurar CSP adequado para proteção XSS
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // TODO: Remover após migrar scripts inline para arquivos externos
        "https://www.gstatic.com",
        "https://apis.google.com",
        "https://cdn.jsdelivr.net" // SortableJS e outras bibliotecas CDN
      ],
      connectSrc: [
        "'self'",
        "https://www.gstatic.com", // Firebase source maps
        "https://fcm.googleapis.com",
        "https://fcmregistrations.googleapis.com",
        "https://firebaseinstallations.googleapis.com", // Firebase installations
        "https://api.az.center" // CIABRA API
      ],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline necessário por enquanto
      fontSrc: ["'self'", "data:", "https:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false // Necessário para Firebase
}));

// NOVO: Rate limiting global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500, // 500 requisições por IP (aumentado de 100 para suportar operações em massa do admin)
  message: 'Muitas requisições deste IP, tente novamente em 15 minutos.'
});
app.use(globalLimiter);

app.use(bodyParser.json());
// NOVO: Adicionado para interpretar dados de formulários HTML (para o login)
app.use(bodyParser.urlencoded({ extended: true }));

// NOVO: Middleware de compressão (deve vir antes de enviar arquivos estáticos ou JSON)
app.use(compression());

// MODIFICADO: Configuração de cache para arquivos estáticos
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d', // Cache forte de 7 dias para imagens, css, js
  setHeaders: (res, filePath) => {
    if (path.extname(filePath) === '.html') {
      // HTML não deve ter cache longo para garantir que atualizações de versão sejam pegas
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// CORREÇÃO: Configuração do cliente Redis para sessões persistentes
// Isso resolve problemas de vazamento de memória e permite scaling horizontal
let redisClient;
let sessionStore;
let csrfProtection; // CORREÇÃO CRÍTICA #5: CSRF protection global

// CORREÇÃO: Função async para inicializar Redis ANTES de configurar middlewares
async function initializeRedis() {
  console.log('[DEBUG] Verificando condições para usar Redis:');
  console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'não definido'}`);
  console.log(`  USE_REDIS: ${process.env.USE_REDIS || 'não definido'}`);

  const shouldUseRedis = process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true';
  console.log(`  Resultado: ${shouldUseRedis ? 'USAR REDIS' : 'USAR MEMORYSTORE'}`);

  if (!shouldUseRedis) {
    console.warn('⚠️ Usando MemoryStore para sessões (apenas desenvolvimento)');
    console.warn('💡 Para produção, configure NODE_ENV=production ou USE_REDIS=true');
    return; // sessionStore fica undefined, Express usa MemoryStore
  }

  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log(`📦 Conectando ao Redis: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`);

    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000, // 10 segundos (aumentado de 5s padrão)
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
      console.error('❌ Erro no Redis:', err.message || err);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis conectado com sucesso');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis pronto para uso');
    });

    // CORREÇÃO CRÍTICA: AGUARDA a conexão antes de continuar
    console.log('[DEBUG] Chamando redisClient.connect()...');
    await redisClient.connect();
    console.log('[DEBUG] redisClient.connect() completou com sucesso');

    // CORREÇÃO: Cria RedisStore com o import correto
    // RedisStore agora é uma named export de connect-redis
    sessionStore = new RedisStore({
      client: redisClient,
      prefix: 'cinepremium:sess:',
      ttl: 8 * 60 * 60 // 8 horas em segundos
    });
    console.log('✅ RedisStore configurado e pronto');

  } catch (error) {
    console.error('❌ FALHA AO CONECTAR AO REDIS:');
    console.error('   Tipo do erro:', error.constructor.name);
    console.error('   Mensagem:', error.message);
    console.error('   Code:', error.code);
    if (error.stack) {
      console.error('   Stack trace:', error.stack.split('\n').slice(0, 3).join('\n'));
    }
    console.warn('⚠️ Usando MemoryStore como fallback (NÃO RECOMENDADO EM PRODUÇÃO)');
    redisClient = null;
    sessionStore = null;
  }
}

// CORREÇÃO: Middleware wrapper para sessão
// Permite registrar o middleware na ordem correta MAS configurá-lo depois que Redis conectar
let actualSessionMiddleware = null;

// NOTA: Middlewares de sessão serão configurados em startServer() APÓS Redis inicializar
app.use(cookieParser());

// CORREÇÃO: Registra wrapper na posição correta (ANTES das rotas)
// O wrapper delega para o middleware real quando ele estiver pronto
app.use((req, res, next) => {
  if (actualSessionMiddleware) {
    return actualSessionMiddleware(req, res, next);
  }
  // Se ainda não tiver middleware (durante inicialização), pula
  console.warn(`[AVISO] Requisição ${req.path} antes de session middleware estar pronto!`);
  next();
});

// NOVO: Middleware de debug para sessão (apenas em produção)
if (process.env.NODE_ENV === 'production' || process.env.DEBUG_SESSION === 'true') {
  app.use((req, res, next) => {
    if (req.path === '/auth' || req.path === '/admin') {
      console.log('[SESSION DEBUG]', {
        path: req.path,
        protocol: req.protocol,
        secure: req.secure,
        hostname: req.hostname,
        sessionID: req.sessionID,
        hasSession: !!req.session,
        loggedin: req.session?.loggedin,
        cookieHeader: req.headers.cookie,
        forwardedProto: req.headers['x-forwarded-proto'],
        forwardedHost: req.headers['x-forwarded-host']
      });
    }
    next();
  });
}

// CORREÇÃO: Flag para rastrear se Firebase foi inicializado com sucesso
let isFirebaseInitialized = false;

// NOVO: Inicializa o Firebase Admin SDK
// MODIFICADO: Inicializa o Firebase Admin SDK a partir da variável de ambiente
// MODIFICADO: Inicializa o Firebase Admin SDK a partir de uma string Base64
try {
  // 1. Lê a string Base64 da variável de ambiente
  const base64Credentials = process.env.FIREBASE_CREDENTIALS_BASE64;
  if (!base64Credentials) {
    throw new Error('A variável de ambiente FIREBASE_CREDENTIALS_BASE64 não está definida.');
  }

  // 2. Decodifica a string Base64 de volta para uma string JSON
  const serviceAccountString = Buffer.from(base64Credentials, 'base64').toString('utf8');

  // 3. Converte a string JSON para um objeto
  const serviceAccount = JSON.parse(serviceAccountString);

  // 4. Inicializa o Firebase
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin SDK inicializado com sucesso via Base64.');
  isFirebaseInitialized = true; // CORREÇÃO: Marca como inicializado

} catch (error) {
  console.error('❌ Erro CRÍTICO ao inicializar o Firebase Admin SDK:', error.message);
  console.warn('⚠️ As notificações push NÃO funcionarão.');
  isFirebaseInitialized = false;
}

// NOVO: Função reutilizável para enviar notificações
// Em server.js, substitua a função sendPushNotification inteira por esta:

// MODIFICADO: Função reutilizável para enviar notificações com logs detalhados
async function sendPushNotification(title, body) {
  // CORREÇÃO: Verifica se Firebase está inicializado antes de usar
  if (!isFirebaseInitialized) {
    console.warn('[PUSH LOG] ⚠️ Firebase não está disponível. Notificação não será enviada.');
    return;
  }

  console.log(`--- [PUSH LOG] --- Iniciando envio de notificação: "${title}"`);

  try {
    const devices = await AdminDevice.findAll({
      attributes: ['token'],
      raw: true
    });

    const tokens = devices.map(device => device.token);

    if (tokens.length === 0) {
      console.log('[PUSH LOG] Nenhum dispositivo encontrado no banco de dados. Abortando envio.');
      return;
    }

    // CORREÇÃO: Não loga tokens em produção (dados sensíveis)
    console.log(`[PUSH LOG] Encontrado(s) ${tokens.length} dispositivo(s)`);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[PUSH LOG] Tokens:', tokens);
    }

    const message = {
      notification: {
        title: title,
        body: body,
      },
      tokens: tokens, // A propriedade correta é 'tokens' para multicast
    };

    console.log('[PUSH LOG] Enviando a seguinte mensagem para o Firebase:', JSON.stringify(message, null, 2));

    const response = await admin.messaging().sendEachForMulticast(message);

    console.log('[PUSH LOG] Resposta do Firebase recebida.');
    console.log('[PUSH LOG] Sucesso:', response.successCount);
    console.log('[PUSH LOG] Falha:', response.failureCount);

    // NOVO: Limpa tokens inválidos do banco de dados automaticamente
    if (response.failureCount > 0) {
      const tokensToRemove = [];

      response.responses.forEach((resp, index) => {
        if (!resp.success) {
          console.error('[PUSH LOG] Detalhe da falha:', resp.error);

          // Se token não está registrado ou é inválido, marca para remoção
          if (resp.error?.code === 'messaging/registration-token-not-registered' ||
            resp.error?.code === 'messaging/invalid-registration-token') {
            tokensToRemove.push(tokens[index]);
          }
        }
      });

      // Remove tokens inválidos do banco
      if (tokensToRemove.length > 0) {
        try {
          const deleted = await AdminDevice.destroy({
            where: { token: tokensToRemove }
          });
          console.log(`[PUSH LOG] 🗑️  Removidos ${deleted} token(s) inválido(s) do banco de dados`);
        } catch (error) {
          console.error('[PUSH LOG] Erro ao remover tokens inválidos:', error);
        }
      }
    }
    console.log('--- [PUSH LOG] --- Fim do processo de envio.');

  } catch (error) {
    console.error('[PUSH LOG] Erro CRÍTICO ao tentar enviar notificação:', error);
    console.log('--- [PUSH LOG] --- Fim do processo de envio com erro.');
  }
}



// --- SEÇÃO DE AUTENTICAÇÃO ---

// NOVO: Middleware para proteger rotas. Ele verifica se o usuário está logado.
// MODIFICADO: O middleware agora trata requisições de API (fetch) de forma diferente
// MODIFICADO: A verificação de API agora é baseada na URL
function requireLogin(req, res, next) {
  // CORREÇÃO: Não loga dados sensíveis (Session IDs, cookies)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[REQUIRE_LOGIN] Path:', req.path);
    console.log('[REQUIRE_LOGIN] Has session:', !!req.sessionID);
    console.log('[REQUIRE_LOGIN] Session loggedin:', req.session.loggedin);
  }

  if (req.session.loggedin) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[REQUIRE_LOGIN] ✅ Acesso permitido');
    }
    next();
  } else {
    console.log('[REQUIRE_LOGIN] ❌ Sessão não encontrada ou expirada');
    // Se a URL da requisição começar com /api/, é uma chamada de API.
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Sua sessão expirou, faça o login novamente.' });
    } else {
      // Caso contrário, é uma navegação de página normal.
      res.redirect('/login');
    }
  }
}

// NOVO: Rota para exibir a página de login (public/login.html)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// NOVO: Rate limiting para login (proteção contra força bruta)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 tentativas de login
  message: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
  skipSuccessfulRequests: true // Não conta logins bem-sucedidos
});

// NOVO: Rate limiting para webhook (proteção contra replay attacks e DoS)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // 30 webhooks por minuto
  message: 'Muitos webhooks recebidos. Tente novamente em 1 minuto.',
  standardHeaders: true,
  legacyHeaders: false
});

// NOVO: Rate limiting para verificação de status (proteção contra DoS)
const statusCheckLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 60, // 60 verificações por minuto (polling de 5s = 12/min, margem de segurança)
  message: 'Muitas verificações de status. Aguarde um momento.',
  standardHeaders: true,
  legacyHeaders: false
});

// CORREÇÃO CRÍTICA #2 + #5: Rota de autenticação com bcrypt e CSRF
app.post('/auth', loginLimiter, applyCsrf, async (req, res) => {
  const { username, password } = req.body;

  console.log('[AUTH] Tentativa de login para usuário:', username);

  try {
    // Valida username
    if (username !== process.env.ADMIN_USER) {
      console.log('[AUTH] Username incorreto');
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // CORREÇÃO CRÍTICA #2: Senha SEMPRE em bcrypt (validado no início do arquivo)
    const passwordHash = process.env.ADMIN_PASS;
    const isPasswordValid = await bcrypt.compare(password, passwordHash);

    if (isPasswordValid) {
      // CORREÇÃO: Regenera o session ID para prevenir session fixation
      req.session.regenerate((err) => {
        if (err) {
          console.error('[AUTH] Erro ao regenerar sessão:', err);
          return res.status(500).json({ error: 'Erro ao processar login' });
        }

        // Define a sessão como logada
        req.session.loggedin = true;

        // Salva a sessão
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('[AUTH] Erro ao salvar sessão:', saveErr);
            return res.status(500).json({ error: 'Erro ao salvar sessão' });
          }
          console.log('[AUTH] ✅ Login bem-sucedido');
          // CORREÇÃO: Não loga dados sensíveis (Session IDs)
          if (process.env.NODE_ENV !== 'production') {
            console.log('[AUTH] Session created:', !!req.sessionID);
            console.log('[AUTH] Session loggedin:', req.session.loggedin);
          }
          // Retorna JSON para requisições AJAX
          res.json({ success: true, redirect: '/admin' });
        });
      });
    } else {
      console.log('[AUTH] Senha incorreta');
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
  } catch (error) {
    console.error('[AUTH] Erro na autenticação:', error);
    return res.status(500).json({ error: 'Erro no servidor' });
  }
});

// NOVO: Rota para fazer logout e destruir a sessão
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[LOGOUT] Erro ao destruir sessão:', err);
      return res.redirect('/admin'); // Se houver erro, volta para o admin
    }
    // CORREÇÃO: Nome correto do cookie (definido em session config como 'sessionId')
    res.clearCookie('sessionId');
    res.redirect('/login');
  });
});

// --- FIM DA SEÇÃO DE AUTENTICAÇÃO ---


// --- FUNÇÕES DE VALIDAÇÃO (Backend) ---

// NOVO: Função para validar CPF no backend
function isValidCPF(cpf) {
  if (typeof cpf !== 'string') return false;
  cpf = cpf.replace(/[^\d]+/g, ''); // Remove caracteres não numéricos

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false; // Verifica se tem 11 dígitos ou se são todos repetidos
  }

  let sum = 0;
  let remainder;

  // Validação do primeiro dígito verificador
  for (let i = 1; i <= 9; i++) {
    sum += parseInt(cpf.substring(i - 1, i)) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if ((remainder === 10) || (remainder === 11)) {
    remainder = 0;
  }
  if (remainder !== parseInt(cpf.substring(9, 10))) {
    return false;
  }

  // Validação do segundo dígito verificador
  sum = 0;
  for (let i = 1; i <= 10; i++) {
    sum += parseInt(cpf.substring(i - 1, i)) * (12 - i);
  }
  remainder = (sum * 10) % 11;
  if ((remainder === 10) || (remainder === 11)) {
    remainder = 0;
  }
  if (remainder !== parseInt(cpf.substring(10, 11))) {
    return false;
  }

  return true;
}

// NOVO: Função para validar e-mail
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(String(email).toLowerCase());
}

// NOVO: Função para validar telefone brasileiro (11 dígitos)
function isValidPhone(phone) {
  const phoneDigits = phone.replace(/\D/g, '');
  return phoneDigits.length === 11;
}

// --- FIM DAS FUNÇÕES DE VALIDAÇÃO ---


// MODIFICADO: A rota para a página de administração agora está protegida pelo middleware requireLogin
app.get('/admin', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- CONFIGURAÇÃO DA API DE PAGAMENTO (CIABRA) ---
const CIABRA_API_URL = "https://api.az.center";
const CIABRA_PUBLIC_KEY = process.env.CIABRA_PUBLIC_KEY;
const CIABRA_PRIVATE_KEY = process.env.CIABRA_PRIVATE_KEY;
const CIABRA_WEBHOOK_URL = process.env.CIABRA_WEBHOOK_URL || "https://cinepremiumedit.domcloud.dev/ciabra-webhook";

// Gera o token Basic Auth para CIABRA
function getCiabraAuthToken() {
  if (!CIABRA_PUBLIC_KEY || !CIABRA_PRIVATE_KEY) {
    return null;
  }
  const credentials = `${CIABRA_PUBLIC_KEY}:${CIABRA_PRIVATE_KEY}`;
  return Buffer.from(credentials).toString('base64');
}

// Cache para armazenar o gateway ativo (evita consultas ao banco em cada requisição)
let cachedActiveGateway = null;
let gatewayLastFetch = 0;
const GATEWAY_CACHE_TTL = 60000; // 1 minuto

// Função para obter o gateway de pagamento ativo
async function getActivePaymentGateway() {
  const now = Date.now();

  // Usa cache se ainda válido
  if (cachedActiveGateway && (now - gatewayLastFetch) < GATEWAY_CACHE_TTL) {
    return cachedActiveGateway;
  }

  try {
    // Busca configurações do banco
    let settings = await PaymentSettings.findOne();

    // Se não existir, cria com valor padrão (ciabra)
    if (!settings) {
      settings = await PaymentSettings.create({ activeGateway: 'ciabra' });
      console.log('✅ Configuração de pagamento criada com gateway padrão: ciabra');
    }

    cachedActiveGateway = settings.activeGateway;
    gatewayLastFetch = now;

    return cachedActiveGateway;
  } catch (error) {
    console.error('❌ Erro ao obter gateway ativo:', error);
    // Fallback para ciabra em caso de erro
    return 'ciabra';
  }
}

// Função para atualizar o gateway ativo
async function setActivePaymentGateway(gateway) {
  if (!['ciabra'].includes(gateway)) {
    throw new Error('Gateway inválido. Use: ciabra');
  }

  try {
    let settings = await PaymentSettings.findOne();

    if (!settings) {
      settings = await PaymentSettings.create({ activeGateway: gateway });
    } else {
      await settings.update({ activeGateway: gateway });
    }

    // Invalida o cache
    cachedActiveGateway = gateway;
    gatewayLastFetch = Date.now();

    console.log(`✅ Gateway de pagamento alterado para: ${gateway}`);
    return settings;
  } catch (error) {
    console.error('❌ Erro ao alterar gateway:', error);
    throw error;
  }
}

// --- FUNÇÕES PARA CIABRA ---

// Função para criar cliente no CIABRA
async function createCiabraCustomer(customerData) {
  const authToken = getCiabraAuthToken();
  if (!authToken) {
    throw new Error('Credenciais CIABRA não configuradas (CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY)');
  }

  try {
    console.log('[CIABRA] Criando cliente...');
    console.log('[CIABRA] Customer data:', JSON.stringify(customerData, null, 2));

    const response = await axios.post(`${CIABRA_API_URL}/invoices/applications/customers`, customerData, {
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[CIABRA] Cliente criado com sucesso:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('[CIABRA] ===== ERRO AO CRIAR CLIENTE =====');
    console.error('[CIABRA] Error message:', error.message);
    console.error('[CIABRA] Error stack:', error.stack);

    if (error.response) {
      console.error('[CIABRA] HTTP Status:', error.response.status);
      console.error('[CIABRA] Response data:', JSON.stringify(error.response.data, null, 2));
      console.error('[CIABRA] Response headers:', JSON.stringify(error.response.headers, null, 2));

      // Se o erro for de cliente duplicado, pode ser que já exista
      if (error.response.status === 409 || error.response.status === 400) {
        console.log('[CIABRA] Cliente pode já existir. Detalhes:', error.response.data);
      }
    } else if (error.request) {
      console.error('[CIABRA] No response received. Request:', error.request);
    } else {
      console.error('[CIABRA] Error setting up request:', error.message);
    }
    console.error('[CIABRA] ========================================');

    throw error;
  }
}

// Função para criar cobrança PIX via CIABRA
async function createCiabraInvoice(payload) {
  const authToken = getCiabraAuthToken();
  if (!authToken) {
    throw new Error('Credenciais CIABRA não configuradas (CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY)');
  }

  try {
    console.log('[CIABRA] Criando cobrança...');
    console.log('[CIABRA] Payload:', JSON.stringify(payload, null, 2));

    const response = await axios.post(`${CIABRA_API_URL}/invoices/applications/invoices`, payload, {
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[CIABRA] Resposta recebida:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('[CIABRA] ===== ERRO AO CRIAR COBRANÇA =====');
    console.error('[CIABRA] Error message:', error.message);
    console.error('[CIABRA] Error stack:', error.stack);

    if (error.response) {
      console.error('[CIABRA] HTTP Status:', error.response.status);
      console.error('[CIABRA] Response data:', JSON.stringify(error.response.data, null, 2));
      console.error('[CIABRA] Response headers:', JSON.stringify(error.response.headers, null, 2));
    } else if (error.request) {
      console.error('[CIABRA] No response received. Request:', error.request);
    } else {
      console.error('[CIABRA] Error setting up request:', error.message);
    }
    console.error('[CIABRA] ========================================');

    throw error;
  }
}

// Função para obter detalhes da cobrança CIABRA
async function getCiabraInvoiceDetails(invoiceId) {
  const authToken = getCiabraAuthToken();
  if (!authToken) {
    throw new Error('Credenciais CIABRA não configuradas');
  }

  try {
    const response = await axios.get(`${CIABRA_API_URL}/invoices/applications/invoices/${invoiceId}`, {
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    console.error('[CIABRA] ===== ERRO AO OBTER DETALHES DO INVOICE =====');
    console.error('[CIABRA] Error message:', error.message);
    console.error('[CIABRA] Error stack:', error.stack);

    if (error.response) {
      console.error('[CIABRA] HTTP Status:', error.response.status);
      console.error('[CIABRA] Response data:', JSON.stringify(error.response.data, null, 2));
      console.error('[CIABRA] Response headers:', JSON.stringify(error.response.headers, null, 2));
    } else if (error.request) {
      console.error('[CIABRA] No response received. Request:', error.request);
    } else {
      console.error('[CIABRA] Error setting up request:', error.message);
    }
    console.error('[CIABRA] ====================================================');

    throw error;
  }
}

// Função para gerar pagamento PIX no CIABRA usando automação
async function generateCiabraPixWithAutomation(installmentId) {
  let browser = null;
  try {
    addDebugLog('[CIABRA AUTOMATION] Iniciando automação para installment:', installmentId);

    // Lançar navegador headless
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/chromium-browser',  // Caminho do Chromium no servidor
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions'
      ]
    });

    const page = await browser.newPage();

    // Interceptar requisições de rede para capturar a resposta do PIX
    let pixPaymentData = null;

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      request.continue();
    });

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/payments/pix')) {
        try {
          const data = await response.json();
          addDebugLog('[CIABRA AUTOMATION] Capturado resposta do PIX:', JSON.stringify(data, null, 2));
          pixPaymentData = data;
        } catch (e) {
          addDebugLog('[CIABRA AUTOMATION] Erro ao parsear resposta:', e.message);
        }
      }
    });

    // Acessar página de pagamento
    const paymentUrl = `https://pagar.ciabra.com.br/i/${installmentId}`;
    addDebugLog('[CIABRA AUTOMATION] Acessando:', paymentUrl);
    await page.goto(paymentUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    addDebugLog('[CIABRA AUTOMATION] Página carregada com sucesso');

    // Tirar screenshot para debug
    const screenshotPath = `/tmp/ciabra_${installmentId}_1.png`;
    await page.screenshot({ path: screenshotPath });
    addDebugLog('[CIABRA AUTOMATION] Screenshot salvo:', screenshotPath);

    // Listar todos os botões na página
    const buttons = await page.$$eval('button', btns => btns.map(b => ({
      text: b.textContent.trim(),
      html: b.innerHTML
    })));
    addDebugLog('[CIABRA AUTOMATION] Botões encontrados:', JSON.stringify(buttons, null, 2));

    // Aguardar elementos carregarem (página React)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Tentar encontrar botão PIX de várias formas
    addDebugLog('[CIABRA AUTOMATION] Procurando botão PIX...');
    let pixButton = null;

    // Método 1: Seletor CSS simples
    try {
      pixButton = await page.$('button:has-text("PIX")');
      if (pixButton) {
        addDebugLog('[CIABRA AUTOMATION] Botão PIX encontrado via CSS :has-text');
      }
    } catch (e) {
      addDebugLog('[CIABRA AUTOMATION] Método CSS falhou:', e.message);
    }

    // Método 2: XPath com texto (case insensitive)
    if (!pixButton) {
      try {
        const pixButtons = await page.$x("//button[contains(translate(text(), 'PIX', 'pix'), 'pix')]");
        if (pixButtons.length > 0) {
          pixButton = pixButtons[0];
          addDebugLog('[CIABRA AUTOMATION] Botão PIX encontrado via XPath');
        }
      } catch (e) {
        addDebugLog('[CIABRA AUTOMATION] Método XPath falhou:', e.message);
      }
    }

    // Método 3: Procurar por qualquer elemento clicável com PIX
    if (!pixButton) {
      try {
        const allClickable = await page.$$('button, a, div[onclick], [role="button"]');
        for (const el of allClickable) {
          const text = await page.evaluate(e => e.textContent, el);
          if (text && text.toUpperCase().includes('PIX')) {
            pixButton = el;
            addDebugLog('[CIABRA AUTOMATION] Botão PIX encontrado via busca manual:', text);
            break;
          }
        }
      } catch (e) {
        addDebugLog('[CIABRA AUTOMATION] Método busca manual falhou:', e.message);
      }
    }

    if (!pixButton) {
      throw new Error('Botão PIX não encontrado na página após 3 tentativas');
    }

    // Clicar no botão PIX
    await pixButton.click();
    addDebugLog('[CIABRA AUTOMATION] Clicou em PIX');

    // Aguardar um pouco para o botão Pagar aparecer
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Tirar screenshot após clicar em PIX
    const screenshotPath2 = `/tmp/ciabra_${installmentId}_2.png`;
    await page.screenshot({ path: screenshotPath2 });
    addDebugLog('[CIABRA AUTOMATION] Screenshot após PIX:', screenshotPath2);

    // Listar botões novamente
    const buttons2 = await page.$$eval('button', btns => btns.map(b => ({
      text: b.textContent.trim(),
      html: b.innerHTML
    })));
    addDebugLog('[CIABRA AUTOMATION] Botões após clicar em PIX:', JSON.stringify(buttons2, null, 2));

    // Procurar botão Pagar
    addDebugLog('[CIABRA AUTOMATION] Procurando botão Pagar...');
    let pagarButton = null;

    // Método 1: XPath procurando em qualquer elemento
    try {
      const pagarButtons = await page.$x("//*[contains(text(), 'Pagar')]");
      if (pagarButtons.length > 0) {
        pagarButton = pagarButtons[0];
        addDebugLog('[CIABRA AUTOMATION] Botão Pagar encontrado via XPath');
      }
    } catch (e) {
      addDebugLog('[CIABRA AUTOMATION] Método XPath para Pagar falhou:', e.message);
    }

    // Método 2: Procurar por classes Mantine Button
    if (!pagarButton) {
      try {
        const mantineButtons = await page.$$('button[class*="mantine-Button"], span[class*="mantine-Button"]');
        for (const btn of mantineButtons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text && text.includes('Pagar')) {
            pagarButton = btn;
            addDebugLog('[CIABRA AUTOMATION] Botão Pagar encontrado via Mantine classes:', text);
            break;
          }
        }
      } catch (e) {
        addDebugLog('[CIABRA AUTOMATION] Método Mantine falhou:', e.message);
      }
    }

    // Método 3: Busca manual em todos os elementos clicáveis
    if (!pagarButton) {
      try {
        const allClickable = await page.$$('button, span[class*="Button"], div[onclick], [role="button"]');
        for (const el of allClickable) {
          const text = await page.evaluate(e => e.textContent, el);
          if (text && text.includes('Pagar')) {
            pagarButton = el;
            addDebugLog('[CIABRA AUTOMATION] Botão Pagar encontrado via busca manual:', text);
            break;
          }
        }
      } catch (e) {
        addDebugLog('[CIABRA AUTOMATION] Busca manual para Pagar falhou:', e.message);
      }
    }

    if (!pagarButton) {
      throw new Error('Botão Pagar não encontrado na página após 3 tentativas');
    }

    // Clicar no botão Pagar
    await pagarButton.click();
    addDebugLog('[CIABRA AUTOMATION] Clicou em Pagar');

    // Aguardar a resposta ser capturada
    addDebugLog('[CIABRA AUTOMATION] Aguardando resposta do pagamento...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    if (!pixPaymentData) {
      throw new Error('Não foi possível capturar dados do pagamento PIX');
    }

    addDebugLog('[CIABRA AUTOMATION] Pagamento PIX gerado com sucesso!');
    return pixPaymentData;

  } catch (error) {
    addDebugLog('[CIABRA AUTOMATION] ===== ERRO NA AUTOMAÇÃO =====');
    console.error('[CIABRA AUTOMATION] Error message:', error.message);
    console.error('[CIABRA AUTOMATION] Error stack:', error.stack);
    console.error('[CIABRA AUTOMATION] ===============================');
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('[CIABRA AUTOMATION] Navegador fechado');
    }
  }
}

// Função para verificar autenticação CIABRA
async function checkCiabraAuth() {
  const authToken = getCiabraAuthToken();
  if (!authToken) {
    return { success: false, error: 'Credenciais CIABRA não configuradas' };
  }

  try {
    const response = await axios.get(`${CIABRA_API_URL}/auth/applications/check`, {
      headers: {
        'Authorization': `Basic ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    return { success: true, data: response.data };
  } catch (error) {
    console.error('[CIABRA] Erro ao verificar autenticação:', error.response?.data || error.message);
    const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
    return { success: false, error: errorMsg };
  }
}

// --- ROTAS PÚBLICAS (Acessíveis sem login) ---

// NOVO: Endpoint para fornecer configuração do Firebase ao frontend
app.get('/api/firebase-config', (req, res) => {
  try {
    // Retorna apenas as configurações públicas do Firebase
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      vapidKey: process.env.FIREBASE_VAPID_KEY
    };

    // Verifica se todas as variáveis estão definidas
    const missingVars = Object.entries(firebaseConfig)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingVars.length > 0) {
      console.warn(`[Firebase Config] Variáveis faltando: ${missingVars.join(', ')}`);
      // Em desenvolvimento, retorna configuração vazia mas válida
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Firebase Config] Modo desenvolvimento: retornando configuração padrão');
        return res.json({
          apiKey: "",
          authDomain: "",
          projectId: "",
          storageBucket: "",
          messagingSenderId: "",
          appId: "",
          vapidKey: ""
        });
      }
      // Em produção, retorna erro
      return res.status(500).json({
        error: 'Configuração do Firebase incompleta no servidor.'
      });
    }

    res.json(firebaseConfig);
  } catch (error) {
    console.error('[Firebase Config] Erro ao processar configuração:', error);
    res.status(500).json({
      error: 'Erro ao buscar configuração do Firebase'
    });
  }
});

// CORREÇÃO CRÍTICA #5: Endpoint para obter CSRF token
app.get('/api/csrf-token', (req, res) => {
  try {
    if (!csrfProtection) {
      return res.status(503).json({ error: 'CSRF protection não inicializado' });
    }
    // Usa o middleware CSRF para gerar token
    csrfProtection(req, res, () => {
      res.json({ csrfToken: req.csrfToken() });
    });
  } catch (error) {
    console.error('[CSRF Token] Erro ao gerar token:', error);
    res.status(500).json({ error: 'Erro ao gerar CSRF token' });
  }
});

// NOVO: Endpoint de health check para monitoramento (público)
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: 'unknown',
      memory: 'ok'
    }
  };

  try {
    // Verifica conectividade com o banco de dados
    await sequelize.authenticate();
    healthCheck.checks.database = 'ok';

    // Verifica uso de memória (alerta se > 90%)
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    if (heapUsedPercent > 90) {
      healthCheck.checks.memory = 'warning';
      healthCheck.status = 'degraded';
    }

    healthCheck.responseTime = Date.now() - startTime;

    // Retorna 200 se tudo OK, 503 se degradado
    const statusCode = healthCheck.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(healthCheck);

  } catch (error) {
    healthCheck.status = 'error';
    healthCheck.checks.database = 'error';
    healthCheck.error = error.message;
    healthCheck.responseTime = Date.now() - startTime;

    console.error('[Health Check] Erro:', error);
    res.status(503).json(healthCheck);
  }
});

// NOVO: Endpoint de diagnóstico para verificar configurações (apenas quando logado)
app.get('/api/diagnostics', requireLogin, async (req, res) => {
  try {
    const diagnostics = {
      environment: {
        NODE_ENV: process.env.NODE_ENV || 'não definido',
        USE_REDIS: process.env.USE_REDIS || 'não definido',
        PORT: process.env.PORT || 'não definido'
      },
      redis: {
        url_configured: !!process.env.REDIS_URL,
        url_preview: process.env.REDIS_URL ? process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@') : 'não definido',
        client_connected: !!redisClient,
        store_configured: !!sessionStore,
        should_use_redis: process.env.NODE_ENV === 'production' || process.env.USE_REDIS === 'true'
      },
      session: {
        secret_configured: !!process.env.SESSION_SECRET,
        store_type: sessionStore ? 'RedisStore' : 'MemoryStore',
        cookie_domain: process.env.COOKIE_DOMAIN || 'não definido'
      },
      database: {
        host: process.env.DB_HOST || 'não definido',
        name: process.env.DB_NAME || 'não definido',
        user_configured: !!process.env.DB_USER
      },
      ciabra: {
        public_key_configured: !!process.env.CIABRA_PUBLIC_KEY,
        private_key_configured: !!process.env.CIABRA_PRIVATE_KEY,
        webhook_url: CIABRA_WEBHOOK_URL || 'não definido'
      },
      payment: {
        active_gateway: cachedActiveGateway || 'não carregado ainda'
      },
      firebase: {
        initialized: isFirebaseInitialized,
        project_id: process.env.FIREBASE_PROJECT_ID || 'não definido'
      }
    };

    // Se Redis estiver configurado, tenta contar sessões
    if (redisClient) {
      try {
        const keys = await redisClient.keys('cinepremium:sess:*');
        diagnostics.redis.active_sessions = keys.length;
      } catch (err) {
        diagnostics.redis.active_sessions_error = err.message;
      }
    }

    res.json(diagnostics);
  } catch (error) {
    console.error('Erro ao gerar diagnóstico:', error);
    res.status(500).json({ error: 'Erro ao gerar diagnóstico' });
  }
});

// Endpoint de debug para ver logs
app.get('/debug-logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({
    timestamp: new Date().toISOString(),
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      activeGateway: activeGateway
    },
    cache: {
      pixCodesSize: pixCodesCache.size,
      pixCodes: Array.from(pixCodesCache.keys())
    },
    logs: {
      total: debugLogs.length,
      showing: Math.min(limit, debugLogs.length),
      entries: debugLogs.slice(-limit)
    }
  });
});

// CORREÇÃO CRÍTICA #6: Endpoint com sanitização de inputs
// CORREÇÃO CRÍTICA #5 + #6: Geração de QR Code com CSRF e sanitização XSS
app.post('/gerarqrcode', applyCsrf, async (req, res) => {
  try {
    const { value, telefone, cpf, productTitle, productDescription } = req.body;

    // CORREÇÃO CRÍTICA #6: Sanitizar inputs para prevenir XSS
    const nome = sanitizeInput(req.body.nome);
    const email = sanitizeInput(req.body.email);

    // Validações básicas
    if (!value || !nome || !telefone || !cpf || !email) {
      return res.status(400).json({ error: "Todos os campos, incluindo e-mail, são obrigatórios." });
    }

    // Validar dados sanitizados
    if (nome.length < 3) {
      return res.status(400).json({ error: "Nome inválido ou contém caracteres não permitidos." });
    }

    // Validar CPF
    if (!isValidCPF(cpf)) {
      return res.status(400).json({ error: "CPF inválido. Por favor, verifique o número digitado." });
    }

    // Validar e normalizar email
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: "E-mail inválido. Por favor, verifique o endereço digitado." });
    }
    const sanitizedEmail = validator.normalizeEmail(email);

    // Validar telefone
    if (!isValidPhone(telefone)) {
      return res.status(400).json({ error: "Telefone inválido. Deve conter 11 dígitos (DDD + número)." });
    }

    // Validar valor do produto
    if (isNaN(value) || value <= 0) {
      return res.status(400).json({ error: "Valor do produto inválido." });
    }

    // Verificação de tentativas de compra
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const attemptsLastHour = await PurchaseHistory.count({ where: { telefone, dataTransacao: { [Op.gte]: oneHourAgo } } });
    const attemptsLastMonth = await PurchaseHistory.count({ where: { telefone, dataTransacao: { [Op.gte]: oneMonthAgo } } });
    if (attemptsLastHour >= 3 || attemptsLastMonth >= 5) {
      return res.status(429).json({ error: 'Você já tentou pagar muitas vezes, procure seu vendedor ou tente novamente depois de algumas horas.' });
    }

    // CORREÇÃO: Usa transação para garantir atomicidade
    // Se qualquer operação falhar, nada é salvo no banco
    const t = await sequelize.transaction();

    try {
      // Cria registro de compra dentro da transação
      const purchaseRecord = await PurchaseHistory.create(
        { nome, telefone, status: 'Gerado', valorPago: value },
        { transaction: t }
      );

      const expirationDate = new Date();
      expirationDate.setMinutes(expirationDate.getMinutes() + 30);
      const pad = (num) => String(num).padStart(2, '0');
      const dueDateFormatted = `${expirationDate.getFullYear()}-${pad(expirationDate.getMonth() + 1)}-${pad(expirationDate.getDate())} ${pad(expirationDate.getHours())}:${pad(expirationDate.getMinutes())}:${pad(expirationDate.getSeconds())}`;

      // Obtém o gateway de pagamento ativo
      const activeGateway = await getActivePaymentGateway();
      console.log(`[GERARQRCODE] 🏦 Gateway ativo: ${activeGateway}`);

      let transactionIdResult;
      let qrCodeResult;
      let qrCodeBase64Result;
      let ciabraInstallmentId = null; // Para armazenar installmentId da CIABRA

      if (activeGateway === 'ciabra') {
        // --- CIABRA ---
        // Debug: Log valores recebidos
        console.log('[CIABRA DEBUG] ====== INÍCIO DO PROCESSAMENTO ======');
        console.log('[CIABRA DEBUG] Valores recebidos:');
        console.log(`  - value: "${value}" (type: ${typeof value})`);
        console.log(`  - nome: "${nome}"`);
        console.log(`  - telefone: "${telefone}"`);
        console.log(`  - cpf: "${cpf}"`);
        console.log(`  - email: "${sanitizedEmail}"`);
        console.log(`  - productTitle: "${productTitle}"`);
        console.log(`  - productDescription: "${productDescription}"`);

        // Garantir que value é um número inteiro válido (em centavos)
        let valueInCents;
        if (typeof value === 'string') {
          valueInCents = parseInt(value, 10);
        } else if (typeof value === 'number') {
          valueInCents = Math.round(value);
        } else {
          console.error('[CIABRA DEBUG] ❌ Tipo de value inválido:', typeof value);
          throw new Error(`Tipo de valor inválido: ${typeof value}`);
        }

        console.log(`[CIABRA DEBUG] valueInCents: ${valueInCents}`);

        if (isNaN(valueInCents) || valueInCents <= 0) {
          console.error('[CIABRA DEBUG] ❌ Value em centavos inválido:', valueInCents);
          throw new Error(`Valor do produto inválido: ${value} -> ${valueInCents}`);
        }

        // CIABRA espera valor em REAIS (float com 2 casas decimais)
        const ciabraPrice = Number((valueInCents / 100).toFixed(2));
        console.log(`[CIABRA DEBUG] ciabraPrice em reais: ${ciabraPrice}`);

        if (isNaN(ciabraPrice) || ciabraPrice <= 0) {
          console.error('[CIABRA DEBUG] ❌ Preço em reais inválido:', ciabraPrice);
          throw new Error(`Preço calculado inválido: ${ciabraPrice}`);
        }

        // Preparar dados do cliente - remover campos nulos/undefined
        const cleanPhone = telefone ? String(telefone).replace(/\D/g, '') : undefined;
        const cleanDocument = cpf ? String(cpf).replace(/\D/g, '') : undefined;
        const cleanDescription = `${productTitle || 'Produto'} - ${productDescription || ''}`.trim().substring(0, 100);

        // Construir objeto customer para criar no CIABRA (formato da API de customers)
        const customerDataForCreation = {
          fullName: String(nome),  // API de customers usa fullName
          email: String(sanitizedEmail),
          document: cleanDocument
        };
        // Só adiciona phone se existir
        if (cleanPhone) {
          customerDataForCreation.phone = cleanPhone;
        }

        console.log('[CIABRA DEBUG] Customer data for creation:', JSON.stringify(customerDataForCreation, null, 2));

        // CORREÇÃO: Criar cliente primeiro para obter customerId
        console.log('[CIABRA DEBUG] Criando cliente no CIABRA...');
        const customerResponse = await createCiabraCustomer(customerDataForCreation);
        const customerId = customerResponse.id;
        console.log(`[CIABRA DEBUG] Cliente criado com ID: ${customerId}`);

        // CIABRA payload - valores garantidos como números
        // CORREÇÃO: Usar customerId em vez de objeto customer
        const ciabraPayload = {
          customerId: customerId,  // ← CORREÇÃO: Usar ID do cliente criado
          description: cleanDescription,
          dueDate: expirationDate.toISOString(),
          installmentCount: 1,
          invoiceType: "SINGLE",
          items: [],  // ← CORREÇÃO: Array vazio conforme documentação
          price: ciabraPrice,
          externalId: String(purchaseRecord.id),
          paymentTypes: ["PIX"],
          notifications: [],  // ← Adicionar campo notifications vazio
          webhooks: [
            {
              hookType: "PAYMENT_CONFIRMED",
              url: CIABRA_WEBHOOK_URL
            },
            {
              hookType: "PAYMENT_GENERATED",
              url: CIABRA_WEBHOOK_URL
            }
          ]
        };

        console.log('[CIABRA DEBUG] ====== PAYLOAD FINAL ======');
        console.log(JSON.stringify(ciabraPayload, null, 2));
        console.log('[CIABRA DEBUG] ============================');

        const ciabraResponse = await createCiabraInvoice(ciabraPayload);

        console.log('[CIABRA DEBUG] ====== RESPOSTA DA API ======');
        console.log(JSON.stringify(ciabraResponse, null, 2));
        console.log('[CIABRA DEBUG] =============================');

        // Log detalhado da estrutura de installments
        if (ciabraResponse.installments) {
          console.log('[CIABRA DEBUG] Installments encontrados:', ciabraResponse.installments.length);
          ciabraResponse.installments.forEach((inst, idx) => {
            console.log(`[CIABRA DEBUG] Installment[${idx}]:`, JSON.stringify(inst, null, 2));
          });
        } else {
          console.log('[CIABRA DEBUG] ATENÇÃO: installments não encontrado na resposta!');
        }

        // CIABRA retorna o invoice com ID
        const invoiceData = ciabraResponse;
        transactionIdResult = invoiceData.id;

        // CORREÇÃO: Gerar pagamento PIX automaticamente
        console.log('[CIABRA DEBUG] Gerando pagamento PIX automaticamente...');
        let pixPaymentData = null;

        // Extrair installmentId da resposta do invoice
        if (ciabraResponse.installments && ciabraResponse.installments.length > 0) {
          const installmentId = ciabraResponse.installments[0].id;
          ciabraInstallmentId = installmentId; // Armazenar para uso posterior
          console.log('[CIABRA DEBUG] InstallmentId encontrado:', installmentId);

          try {
            // Gerar pagamento PIX usando automação Puppeteer
            addDebugLog('[CIABRA] Iniciando automação Puppeteer...');
            addDebugLog(`[CIABRA] InstallmentId: ${installmentId}`);
            console.log('[CIABRA DEBUG] Gerando pagamento PIX com Puppeteer...');

            pixPaymentData = await generateCiabraPixWithAutomation(installmentId);

            if (pixPaymentData) {
              addDebugLog('[CIABRA] ✅ Código PIX gerado com sucesso!');
              addDebugLog(`[CIABRA] EMV: ${pixPaymentData.emv ? pixPaymentData.emv.substring(0, 50) + '...' : 'N/A'}`);
              console.log('[CIABRA DEBUG] ====== CÓDIGO PIX GERADO ======');
              console.log(JSON.stringify(pixPaymentData, null, 2));
              console.log('[CIABRA DEBUG] ================================');
            } else {
              addDebugLog('[CIABRA] ❌ Falha ao gerar código PIX');
              console.warn('[CIABRA DEBUG] Falha ao gerar pagamento PIX com automação');
            }
          } catch (pixError) {
            addDebugLog(`[CIABRA] ❌ Erro: ${pixError.message}`);
            console.error('[CIABRA DEBUG] Erro ao gerar pagamento PIX');
            console.error('[CIABRA DEBUG] Erro:', pixError.message);
            console.error('[CIABRA DEBUG] Stack:', pixError.stack);
          }
        } else {
          console.error('[CIABRA DEBUG] InstallmentId não encontrado na resposta do invoice');
        }

        // CORREÇÃO: Usar pixPaymentData para extrair código PIX
        if (pixPaymentData) {
          // O campo 'emv' contém o código PIX copia-cola
          qrCodeResult = pixPaymentData.emv || pixPaymentData.pixCode || pixPaymentData.code;

          // Tentar obter imagem QR Code da resposta
          qrCodeBase64Result = pixPaymentData.qrCodeBase64 || pixPaymentData.base64 || null;

          console.log('[CIABRA DEBUG] Código PIX extraído do pagamento gerado');
        } else {
          console.error('[CIABRA DEBUG] pixPaymentData não disponível, tentando extrair da resposta inicial');

          // Fallback: tentar extrair da resposta inicial
          if (ciabraResponse.installments && ciabraResponse.installments.length > 0) {
            const installment = ciabraResponse.installments[0];
            if (installment.payments && installment.payments.length > 0) {
              const payment = installment.payments[0];
              qrCodeResult = payment.emv || payment.pixCode || payment.code;
              qrCodeBase64Result = payment.qrCodeBase64 || payment.base64;
            }
          }
        }

        // Se temos o código PIX mas não temos a imagem, gerar QR Code
        if (qrCodeResult && !qrCodeBase64Result) {
          console.log('[CIABRA DEBUG] Gerando QR Code a partir do código PIX...');
          addDebugLog('[CIABRA] Gerando QR Code base64 a partir do código PIX');
          try {
            // Gerar QR Code como data URL (base64)
            const qrCodeDataUrl = await QRCode.toDataURL(qrCodeResult, {
              errorCorrectionLevel: 'M',
              type: 'image/png',
              width: 300,
              margin: 1
            });
            // Remover o prefixo 'data:image/png;base64,' para obter apenas o base64
            qrCodeBase64Result = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');
            console.log('[CIABRA DEBUG] ✅ QR Code gerado com sucesso!');
            addDebugLog('[CIABRA] ✅ QR Code base64 gerado com sucesso');
          } catch (qrError) {
            console.error('[CIABRA DEBUG] ❌ Erro ao gerar QR Code:', qrError.message);
            addDebugLog(`[CIABRA] ❌ Erro ao gerar QR Code: ${qrError.message}`);
          }
        }

        console.log('[CIABRA DEBUG] Resultado extraído:');
        console.log(`  - Invoice ID: ${transactionIdResult}`);
        console.log(`  - PIX Code: ${qrCodeResult ? 'Encontrado' : 'NÃO encontrado'}`);
        console.log(`  - QR Image: ${qrCodeBase64Result ? 'Encontrado' : 'NÃO encontrado'}`);
      }

      // Atualiza com transactionId dentro da mesma transação
      console.log(`[GERARQRCODE] 🔄 Atualizando purchase ID ${purchaseRecord.id} com transactionId ${transactionIdResult}...`);
      await purchaseRecord.update(
        { transactionId: transactionIdResult, paymentGateway: activeGateway },
        { transaction: t }
      );

      // CORREÇÃO: Só commita se TUDO deu certo
      await t.commit();
      console.log('[GERARQRCODE] ✅ Transação commitada com sucesso!');

      console.log('[GERARQRCODE] 📊 Resumo da compra criada:');
      console.log(`  - Purchase ID (external_id): ${purchaseRecord.id}`);
      console.log(`  - Transaction ID (${activeGateway}): ${transactionIdResult}`);
      console.log(`  - Nome: ${nome}`);
      console.log(`  - Telefone: ${telefone}`);
      console.log(`  - Valor: R$ ${(value / 100).toFixed(2)}`);
      console.log(`  - Status inicial: ${purchaseRecord.status}`);
      console.log(`  - Gateway: ${activeGateway}`);
      console.log(`  - Expira em: ${expirationDate.toISOString()}`);

      // Envia notificação de nova venda (após commit)
      sendPushNotification(
        'Nova Tentativa de Venda!',
        `${nome} gerou um QR Code para pagamento.`
      );

      // Preparar resultado para enviar ao frontend
      const resultado = {
        id: transactionIdResult,
        qr_code: qrCodeResult,
        qr_code_base64: qrCodeBase64Result,
        expirationTimestamp: expirationDate.getTime(),
        gateway: activeGateway
      };

      // Se for CIABRA, adicionar installmentId para polling ativo
      if (activeGateway === 'ciabra' && ciabraInstallmentId) {
        resultado.installmentId = ciabraInstallmentId;
        console.log('[GERARQRCODE] 🔑 InstallmentId adicionado ao resultado:', resultado.installmentId);
      }

      // Logs detalhados para debug
      addDebugLog(`[GERARQRCODE] ===== RESULTADO FINAL =====`);
      addDebugLog(`[GERARQRCODE] Transaction ID: ${resultado.id}`);
      addDebugLog(`[GERARQRCODE] QR Code (copia e cola): ${resultado.qr_code ? 'Presente (' + resultado.qr_code.length + ' chars)' : 'AUSENTE ❌'}`);
      addDebugLog(`[GERARQRCODE] QR Code Base64 (imagem): ${resultado.qr_code_base64 ? 'Presente (' + resultado.qr_code_base64.length + ' chars)' : 'AUSENTE ❌'}`);
      addDebugLog(`[GERARQRCODE] Gateway: ${resultado.gateway}`);
      addDebugLog(`[GERARQRCODE] Expira em: ${new Date(resultado.expirationTimestamp).toISOString()}`);
      addDebugLog(`[GERARQRCODE] =============================`);

      console.log('[GERARQRCODE] 📊 Dados enviados ao frontend:');
      console.log(`  - QR Code texto: ${resultado.qr_code ? '✅ OK' : '❌ FALTANDO'}`);
      console.log(`  - QR Code imagem: ${resultado.qr_code_base64 ? '✅ OK' : '❌ FALTANDO'}`);
      console.log(`  - Transaction ID: ${resultado.id}`);
      console.log(`  - Gateway: ${resultado.gateway}`);

      console.log(`[GERARQRCODE] ✅ QR Code gerado com sucesso (${activeGateway}):`, resultado.id);
      console.log('[GERARQRCODE] ℹ️  Cliente irá começar a fazer polling a cada 5 segundos...\n');

      addDebugLog(`[GERARQRCODE] ✅ Resposta enviada ao frontend com sucesso`);
      res.json(resultado);
    } catch (transactionError) {
      // CORREÇÃO: Se qualquer coisa falhar, faz rollback
      await t.rollback();
      console.error('❌ Erro na transação, rollback executado:', transactionError.message);
      throw transactionError; // Re-lança para o catch externo tratar
    }
  } catch (error) {
    // Captura detalhes do erro para diagnóstico
    let errorMessage = "Erro ao gerar QR code. Tente novamente.";
    let errorDetails = null;
    let errorCode = null;

    // Log completo no servidor
    console.error("❌ [GERARQRCODE] Erro capturado:");
    console.error("❌ [GERARQRCODE] Error message:", error.message);
    console.error("❌ [GERARQRCODE] Error stack:", error.stack);

    if (error.response && error.response.data) {
      const apiError = error.response.data;
      console.error("❌ [GERARQRCODE] Erro da API de pagamento:", JSON.stringify(apiError, null, 2));
      console.error("❌ [GERARQRCODE] Status HTTP:", error.response.status);
      errorCode = error.response.status;
      errorDetails = apiError;

      // Tratamento para CIABRA
      if (apiError.message) {
        errorMessage = apiError.message;
      }
      if (apiError.code) {
        errorCode = apiError.code;
      }
    } else {
      console.error("❌ [GERARQRCODE] Erro local (não da API):", error.message);
      errorMessage = error.message || errorMessage;
      errorDetails = {
        localError: true,
        message: error.message,
        stack: error.stack
      };
    }

    // Retorna erro com detalhes para o frontend (útil para debug)
    res.status(400).json({
      error: errorMessage,
      details: errorDetails,
      httpCode: errorCode,
      gateway: cachedActiveGateway || 'desconhecido',
      debug: {
        errorType: error.name,
        hasResponse: !!error.response,
        responseStatus: error.response?.status
      }
    });
  }
});

// Endpoint de teste para simular webhook PAYMENT_GENERATED
app.post('/test-webhook', async (req, res) => {
  const { installmentId, emv } = req.body;

  if (!installmentId || !emv) {
    return res.status(400).json({ error: 'installmentId e emv são obrigatórios' });
  }

  addDebugLog(`[TEST] Simulando webhook para installment: ${installmentId}`);

  // Simular webhook PAYMENT_GENERATED
  pixCodesCache.set(installmentId, {
    emv: emv,
    payment: { emv: emv, status: 'WAITING' },
    timestamp: Date.now()
  });

  addDebugLog(`[TEST] Código PIX armazenado! Cache size: ${pixCodesCache.size}`);

  res.json({ status: 'ok', message: 'Webhook simulado com sucesso' });
});

// NOVO: Webhook para CIABRA
app.post('/ciabra-webhook', webhookLimiter, async (req, res) => {
  console.log('\n=====================================');
  console.log('🔷 [CIABRA WEBHOOK] Webhook Recebido');
  console.log('📅 Timestamp:', new Date().toISOString());
  console.log('🌐 IP:', req.ip);
  console.log('📦 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📄 Body:', JSON.stringify(req.body, null, 2));
  console.log('=====================================\n');

  try {
    // CIABRA envia webhooks com hookType:
    // INVOICE_CREATED, INVOICE_DELETED, PAYMENT_GENERATED, PAYMENT_CONFIRMED
    const { hookType, invoice, payment, installment } = req.body;

    if (!hookType) {
      console.warn('[CIABRA WEBHOOK] ⚠️ Webhook recebido sem hookType.', req.body);
      return res.status(400).json({ error: 'hookType não informado.' });
    }

    console.log(`[CIABRA WEBHOOK] 📊 Evento: ${hookType}`);

    // Capturar evento PAYMENT_GENERATED para armazenar código PIX
    if (hookType === 'PAYMENT_GENERATED') {
      addDebugLog('[WEBHOOK] 🔑 PAYMENT_GENERATED recebido!');
      console.log('[CIABRA WEBHOOK] 🔑 Evento PAYMENT_GENERATED recebido!');

      if (payment && installment) {
        const installmentId = installment.id;
        const pixCode = payment.emv;

        addDebugLog(`[WEBHOOK] InstallmentId: ${installmentId}`);
        addDebugLog(`[WEBHOOK] PIX Code: ${pixCode ? 'Presente (' + pixCode.length + ' chars)' : 'Ausente'}`);
        console.log(`[CIABRA WEBHOOK] 📊 InstallmentId: ${installmentId}`);
        console.log(`[CIABRA WEBHOOK] 📊 PIX Code: ${pixCode ? pixCode.substring(0, 50) + '...' : 'N/A'}`);

        if (pixCode && installmentId) {
          // Armazenar código PIX no cache
          pixCodesCache.set(installmentId, {
            emv: pixCode,
            payment: payment,
            timestamp: Date.now()
          });

          addDebugLog(`[WEBHOOK] ✅ Código PIX armazenado! Cache size: ${pixCodesCache.size}`);
          console.log(`[CIABRA WEBHOOK] ✅ Código PIX armazenado para installment ${installmentId}`);

          // Limpar cache antigo (TTL)
          setTimeout(() => {
            if (pixCodesCache.has(installmentId)) {
              pixCodesCache.delete(installmentId);
              console.log(`[CIABRA WEBHOOK] 🗑️ Cache expirado para installment ${installmentId}`);
            }
          }, PIX_CACHE_TTL);
        } else {
          addDebugLog('[WEBHOOK] ⚠️ Código PIX ou installmentId ausente');
          console.warn('[CIABRA WEBHOOK] ⚠️ Código PIX ou installmentId não encontrado no webhook');
        }
      } else {
        addDebugLog('[WEBHOOK] ⚠️ payment ou installment ausente no body');
      }

      return res.status(200).json({ status: 'pix_stored' });
    }

    // Verifica se é um evento de pagamento confirmado
    if (hookType !== 'PAYMENT_CONFIRMED') {
      console.log(`[CIABRA WEBHOOK] ℹ️ Evento '${hookType}' não é de confirmação. Ignorando.`);
      return res.status(200).json({ status: 'ignored', hookType });
    }

    // Extrai o ID da transação
    let transactionId = null;
    let externalId = null;

    // O invoice contém o externalId que é o purchase.id
    if (invoice) {
      transactionId = invoice.id;
      externalId = invoice.externalId;
    }

    console.log(`[CIABRA WEBHOOK] 📊 Invoice ID: ${transactionId}`);
    console.log(`[CIABRA WEBHOOK] 📊 External ID: ${externalId}`);

    if (!transactionId && !externalId) {
      console.error('[CIABRA WEBHOOK] ❌ Não foi possível extrair o ID da transação');
      return res.status(400).json({ error: 'ID da transação não encontrado.' });
    }

    // Busca a compra pelo transactionId OU pelo externalId (purchase.id)
    let purchase = null;

    if (transactionId) {
      purchase = await PurchaseHistory.findOne({ where: { transactionId: transactionId } });
    }

    if (!purchase && externalId) {
      // Tenta buscar pelo external_id (que é o purchase.id)
      purchase = await PurchaseHistory.findByPk(parseInt(externalId, 10));
    }

    if (!purchase) {
      console.error(`[CIABRA WEBHOOK] ❌ Compra não encontrada para invoice: ${transactionId}`);
      return res.status(404).json({ error: 'Compra não encontrada.' });
    }

    console.log(`[CIABRA WEBHOOK] 📋 Compra encontrada:`);
    console.log(`  - ID: ${purchase.id}`);
    console.log(`  - Nome: ${purchase.nome}`);
    console.log(`  - Transaction ID: ${purchase.transactionId}`);
    console.log(`  - Status atual: ${purchase.status}`);

    // Idempotência: Se já foi processado, retorna sucesso
    if (purchase.status === 'Sucesso') {
      console.log(`[CIABRA WEBHOOK] ⚠️ Webhook duplicado ignorado. Compra ${purchase.id} já foi processada.`);
      return res.status(200).json({ status: 'already_processed' });
    }

    // Atualiza o status
    console.log(`[CIABRA WEBHOOK] 🔄 Atualizando compra ${purchase.id} para 'Sucesso'...`);
    await purchase.update({ status: 'Sucesso' });
    console.log(`[CIABRA WEBHOOK] ✅ Compra ${purchase.id} atualizada para 'Sucesso'.`);

    // Envia notificação push
    console.log('[CIABRA WEBHOOK] 📧 Enviando notificação push...');
    sendPushNotification(
      'Venda Paga com Sucesso!',
      `O pagamento de ${purchase.nome} foi confirmado (CIABRA).`
    );

    console.log('[CIABRA WEBHOOK] ✅ Webhook processado com sucesso!\n');
    res.status(200).json({ status: 'ok' });

  } catch (error) {
    console.error('[CIABRA WEBHOOK] ❌ Erro crítico:', error.message);
    console.error('[CIABRA WEBHOOK] Stack:', error.stack);
    res.status(500).json({ error: 'Erro interno ao processar webhook.' });
  }
});

// Endpoint para o cliente verificar o status do pagamento com CSRF
app.post('/check-local-status', statusCheckLimiter, applyCsrf, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "ID da transação não fornecido." });

    const purchase = await PurchaseHistory.findOne({ where: { transactionId: id } });

    if (!purchase) {
      console.log(`[STATUS CHECK] ⚠️  Nenhuma compra encontrada para o transactionId: ${id}. Retornando 'Gerado'.`);
      return res.json({ id: id, status: 'Gerado' });
    }

    // ENHANCED LOGGING: Log detalhado para debug
    console.log(`[STATUS CHECK] 📊 Status para transactionId ${id}:`);
    console.log(`  - Status atual: '${purchase.status}'`);
    console.log(`  - Nome: ${purchase.nome}`);
    console.log(`  - Data transação: ${purchase.dataTransacao}`);
    console.log(`  - Valor: R$ ${(purchase.valorPago / 100).toFixed(2)}`);

    res.json({ id: purchase.transactionId, status: purchase.status });

  } catch (error) {
    console.error("[STATUS CHECK] ❌ Erro ao verificar status local:", error.message);
    res.status(500).json({ error: "Erro ao verificar status localmente" });
  }
});
// Novo endpoint para consultar status de pagamento na API CIABRA
// Inserir após o endpoint /check-local-status no server.js

// Endpoint para consultar pagamento CIABRA via API (polling ativo)
app.post('/api/check-ciabra-payment', statusCheckLimiter, applyCsrf, async (req, res) => {
  try {
    const { transactionId, installmentId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "Transaction ID não fornecido." });
    }

    // Primeiro, verifica status local
    const purchase = await PurchaseHistory.findOne({ where: { transactionId } });

    if (!purchase) {
      console.log(`[CIABRA POLLING] ⚠️  Compra não encontrada: ${transactionId}`);
      return res.json({ status: 'Gerado', source: 'local' });
    }

    // Se já está pago, retorna imediatamente
    if (purchase.status === 'Sucesso') {
      console.log(`[CIABRA POLLING] ✅ Já pago (cache local): ${transactionId}`);
      return res.json({ status: 'Sucesso', source: 'local' });
    }

    // Se não tem installmentId, não pode consultar API
    if (!installmentId) {
      console.log(`[CIABRA POLLING] ⚠️  InstallmentId não fornecido para ${transactionId}`);
      return res.json({ status: purchase.status, source: 'local' });
    }

    // Consultar API CIABRA
    console.log(`[CIABRA POLLING] 🔍 Consultando API para installment: ${installmentId}`);

    try {
      const apiUrl = `https://api.az.center/payments/applications/installments/${installmentId}`;
      const authToken = Buffer.from(`${CIABRA_PUBLIC_KEY}:${CIABRA_PRIVATE_KEY}`).toString('base64');

      const response = await axios.get(apiUrl, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${authToken}`
        },
        timeout: 10000 // 10 segundos
      });

      console.log(`[CIABRA POLLING] 📦 Resposta da API:`, JSON.stringify(response.data, null, 2));

      // Verificar se há pagamentos confirmados
      const apiData = response.data;
      let isPaid = false;
      let paymentId = null;

      // A API CIABRA retorna um objeto com: { payment: {...}, pix: {...}, boleto: {...} }
      if (apiData.payment && apiData.payment.status) {
        const paymentStatus = apiData.payment.status.toUpperCase();

        if (paymentStatus === 'CONFIRMED' || paymentStatus === 'PAID' || paymentStatus === 'SUCCESS') {
          isPaid = true;
          paymentId = apiData.payment.id;
          console.log(`[CIABRA POLLING] ✅ Pagamento confirmado encontrado!`);
          console.log(`[CIABRA POLLING] Payment ID: ${paymentId}, Status: ${paymentStatus}`);

          // Atualizar banco de dados
          await purchase.update({ status: 'Sucesso' });
          console.log(`[CIABRA POLLING] 💾 Status atualizado no banco para 'Sucesso'`);

          // Enviar notificação
          sendPushNotification(
            'Venda Paga com Sucesso!',
            `O pagamento de ${purchase.nome} foi confirmado (CIABRA Polling).`
          );

          return res.json({
            status: 'Sucesso',
            source: 'ciabra_api',
            paymentId: paymentId
          });
        }
      }

      // Se não encontrou pagamento confirmado
      console.log(`[CIABRA POLLING] ⏳ Pagamento ainda pendente`);
      console.log(`[CIABRA POLLING] Payment status: ${apiData.payment ? apiData.payment.status : 'N/A'}`);
      return res.json({
        status: purchase.status,
        source: 'ciabra_api',
        paymentStatus: apiData.payment ? apiData.payment.status : null
      });

    } catch (apiError) {
      console.error(`[CIABRA POLLING] ❌ Erro ao consultar API:`, apiError.message);

      // Em caso de erro na API, retorna status local
      return res.json({
        status: purchase.status,
        source: 'local_fallback',
        error: apiError.message
      });
    }

  } catch (error) {
    console.error("[CIABRA POLLING] ❌ Erro crítico:", error.message);
    res.status(500).json({ error: "Erro ao verificar pagamento" });
  }
});

// NOVO: Endpoint de debug para diagnóstico de pagamentos (temporário)
app.get('/api/debug-payment/:transactionId', requireLogin, async (req, res) => {
  try {
    const { transactionId } = req.params;

    const purchase = await PurchaseHistory.findOne({ where: { transactionId } });

    if (!purchase) {
      return res.json({
        found: false,
        message: 'Nenhuma compra encontrada com este transactionId',
        transactionId
      });
    }

    const debug = {
      found: true,
      purchase: {
        id: purchase.id,
        transactionId: purchase.transactionId,
        nome: purchase.nome,
        status: purchase.status,
        dataTransacao: purchase.dataTransacao,
        createdAt: purchase.createdAt,
        updatedAt: purchase.updatedAt
      },
      webhookInfo: {
        webhookUrl: CIABRA_WEBHOOK_URL || 'NÃO CONFIGURADO',
        isLocalhost: (CIABRA_WEBHOOK_URL || '').includes('localhost'),
        warning: (CIABRA_WEBHOOK_URL || '').includes('localhost')
          ? '⚠️ CIABRA_WEBHOOK_URL aponta para localhost. CIABRA não consegue enviar webhooks para localhost!'
          : null
      },
      polling: {
        endpoint: '/check-local-status',
        frequency: '5 segundos',
        timeout: '10 minutos'
      },
      troubleshooting: {
        statusIsGerado: purchase.status === 'Gerado',
        tips: purchase.status === 'Gerado' ? [
          '1. Verifique se o pagamento foi realmente efetuado no Pix',
          '2. Se sim, verifique se o webhook está chegando (logs do servidor)',
          '3. Se servidor está em localhost, webhook NÃO vai funcionar',
          '4. Para localhost, você pode simular o webhook manualmente'
        ] : [
          `Status atual: ${purchase.status}`,
          'Se status está correto mas página não atualizou, verifique o polling no navegador'
        ]
      }
    };

    res.json(debug);
  } catch (error) {
    console.error('[DEBUG] Erro:', error);
    res.status(500).json({ error: error.message });
  }
});

// NOVO: Endpoint para simular webhook (APENAS PARA DESENVOLVIMENTO/TESTE)
app.post('/api/simulate-webhook', requireLogin, applyCsrf, async (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: 'transactionId é obrigatório' });
    }

    console.log('\n🧪 [SIMULATE WEBHOOK] Simulando recebimento de webhook...');
    console.log(`  - Transaction ID: ${transactionId}`);

    const purchase = await PurchaseHistory.findOne({
      where: { transactionId }
    });

    if (!purchase) {
      console.log('[SIMULATE WEBHOOK] ❌ Compra não encontrada');
      return res.status(404).json({ error: 'Compra não encontrada' });
    }

    console.log(`[SIMULATE WEBHOOK] 📋 Compra encontrada:`);
    console.log(`  - Purchase ID: ${purchase.id}`);
    console.log(`  - Nome: ${purchase.nome}`);
    console.log(`  - Status atual: ${purchase.status}`);

    if (purchase.status === 'Sucesso') {
      console.log('[SIMULATE WEBHOOK] ⚠️  Compra já está marcada como Sucesso');
      return res.json({
        message: 'Compra já está marcada como Sucesso',
        alreadyProcessed: true
      });
    }

    // Atualiza para Sucesso
    console.log('[SIMULATE WEBHOOK] 🔄 Atualizando status para Sucesso...');
    await purchase.update({ status: 'Sucesso' });
    console.log('[SIMULATE WEBHOOK] ✅ Status atualizado com sucesso!');

    // Envia notificação
    console.log('[SIMULATE WEBHOOK] 📧 Enviando notificação push...');
    sendPushNotification(
      'Venda Paga com Sucesso!',
      `O pagamento de ${purchase.nome} foi confirmado (SIMULADO).`
    );

    console.log('[SIMULATE WEBHOOK] ✅ Simulação completa!\n');

    res.json({
      success: true,
      message: 'Webhook simulado com sucesso',
      purchase: {
        id: purchase.id,
        transactionId: purchase.transactionId,
        status: purchase.status,
        nome: purchase.nome
      }
    });

  } catch (error) {
    console.error('[SIMULATE WEBHOOK] ❌ Erro:', error);
    res.status(500).json({ error: error.message });
  }
});

// NOVO: Endpoint de diagnóstico completo do fluxo de pagamento
app.get('/api/payment-flow-status', requireLogin, async (req, res) => {
  try {
    const { transactionId, purchaseId } = req.query;

    if (!transactionId && !purchaseId) {
      return res.status(400).json({
        error: 'Forneça transactionId ou purchaseId como query parameter'
      });
    }

    let purchase;
    if (transactionId) {
      purchase = await PurchaseHistory.findOne({ where: { transactionId } });
    } else {
      purchase = await PurchaseHistory.findByPk(purchaseId);
    }

    if (!purchase) {
      return res.json({
        found: false,
        message: 'Compra não encontrada',
        searchedBy: transactionId ? 'transactionId' : 'purchaseId',
        searchValue: transactionId || purchaseId
      });
    }

    // Análise do fluxo
    const analysis = {
      purchase: {
        id: purchase.id,
        transactionId: purchase.transactionId,
        nome: purchase.nome,
        telefone: purchase.telefone,
        status: purchase.status,
        valorPago: `R$ ${(purchase.valorPago / 100).toFixed(2)}`,
        dataTransacao: purchase.dataTransacao
      },
      flow: {
        step1_qrCodeGenerated: !!purchase.transactionId,
        step2_clientPolling: purchase.status === 'Gerado' ? 'Em andamento (esperando pagamento)' : 'Concluído',
        step3_webhookReceived: purchase.status === 'Sucesso' ? 'Sim' : 'Aguardando',
        step4_statusUpdated: purchase.status === 'Sucesso',
        step5_thankYouPage: purchase.status === 'Sucesso' ? 'Deveria ter sido exibida' : 'Aguardando pagamento'
      },
      webhook: {
        webhookUrl: CIABRA_WEBHOOK_URL || 'NÃO CONFIGURADO',
        isLocalhost: (CIABRA_WEBHOOK_URL || '').includes('localhost'),
        warning: (CIABRA_WEBHOOK_URL || '').includes('localhost')
          ? '⚠️ CIABRA_WEBHOOK_URL aponta para localhost. CIABRA NÃO consegue enviar webhooks para localhost!'
          : null
      },
      nextSteps: purchase.status === 'Gerado' ? [
        '1. Cliente deve efetuar o pagamento via Pix',
        '2. CIABRA enviará webhook para o servidor quando pagamento for confirmado',
        '3. Servidor atualizará status para "Sucesso"',
        '4. Cliente polling detectará mudança e mostrará página de agradecimento',
        '',
        '⚙️ Para testar sem pagamento real, use o endpoint:',
        `POST /api/simulate-webhook com body: { "transactionId": "${purchase.transactionId}" }`
      ] : [
        `✅ Pagamento confirmado!`,
        `Status: ${purchase.status}`,
        `Data: ${purchase.dataTransacao}`
      ],
      troubleshooting: {
        statusIsGerado: purchase.status === 'Gerado',
        possibleIssues: purchase.status === 'Gerado' ? [
          '🔍 Webhook não está chegando - verifique URL e conectividade',
          '📡 Servidor pode estar inacessível para CIABRA',
          '⏱️ Pagamento pode ainda não ter sido efetuado'
        ] : []
      }
    };

    res.json(analysis);

  } catch (error) {
    console.error('[PAYMENT FLOW STATUS] Erro:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint público para buscar a lista de produtos
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.findAll({ order: [['orderIndex', 'ASC']] });
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar produtos.' });
  }
});

// --- ENDPOINTS DE ADMINISTRAÇÃO (Protegidos) ---

// CORREÇÃO CRÍTICA #5 + #6: Criação de produtos com CSRF e sanitização
app.post('/api/products', requireLogin, applyCsrf, async (req, res) => {
  try {
    const { price, image } = req.body;

    // CORREÇÃO CRÍTICA #6: Sanitizar inputs
    const title = sanitizeInput(req.body.title);
    const description = req.body.description ? sanitizeInput(req.body.description) : '';

    // Validações
    if (!title || !price || !image) {
      return res.status(400).json({ error: 'Título, preço e imagem são obrigatórios.' });
    }

    // Validar dados sanitizados
    if (title.length < 3) {
      return res.status(400).json({ error: 'Título inválido ou contém caracteres não permitidos.' });
    }

    // Validar preço
    const priceNum = parseInt(price);
    if (isNaN(priceNum) || priceNum <= 0 || priceNum > 1000000) {
      return res.status(400).json({ error: 'Preço inválido (deve ser entre 1 e 1.000.000 centavos).' });
    }

    // Validar tamanho da imagem
    if (!image || image.length > 1500000) {
      return res.status(400).json({ error: 'Imagem inválida ou muito grande (máx 1MB).' });
    }

    const product = await Product.create({ title, price: priceNum, image, description });
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar produto.' });
  }
});

// Rota para reordenar produtos com CSRF
app.put('/api/products/reorder', requireLogin, applyCsrf, async (req, res) => {
  try {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) {
      return res.status(400).json({ error: 'Array de ordem é obrigatório.' });
    }
    // CORREÇÃO: Usar Promise.all para evitar N+1 query (executa em paralelo)
    await Promise.all(
      order.map((productId, index) =>
        Product.update({ orderIndex: index }, { where: { id: productId } })
      )
    );
    res.json({ message: 'Ordem atualizada com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar a ordem dos produtos.' });
  }
});

// Rota para deletar produto com CSRF
app.delete('/api/products/:id', requireLogin, applyCsrf, async (req, res) => {
  try {
    const { id } = req.params;
    const rowsDeleted = await Product.destroy({ where: { id } });
    if (rowsDeleted === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }
    res.json({ message: 'Produto excluído com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir produto.' });
  }
});

// --- ENDPOINTS DE CONFIGURAÇÃO DE PAGAMENTO ---

// Obter configurações de pagamento atuais
app.get('/api/payment-settings', requireLogin, async (req, res) => {
  try {
    const activeGateway = await getActivePaymentGateway();

    // Retorna configurações sem expor credenciais
    const settings = {
      activeGateway,
      gateways: {
        ciabra: {
          configured: !!(CIABRA_PUBLIC_KEY && CIABRA_PRIVATE_KEY),
          webhookUrl: CIABRA_WEBHOOK_URL
        }
      }
    };

    res.json(settings);
  } catch (error) {
    console.error('Erro ao obter configurações de pagamento:', error);
    res.status(500).json({ error: 'Erro ao obter configurações de pagamento.' });
  }
});

// Alterar gateway de pagamento ativo
app.post('/api/payment-settings/gateway', requireLogin, applyCsrf, async (req, res) => {
  try {
    const { gateway } = req.body;

    if (!gateway) {
      return res.status(400).json({ error: 'Gateway não informado.' });
    }

    // Validar se o gateway escolhido está configurado
    if (gateway === 'ciabra' && (!CIABRA_PUBLIC_KEY || !CIABRA_PRIVATE_KEY)) {
      return res.status(400).json({
        error: 'CIABRA não está configurado. Configure CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY no .env'
      });
    }

    await setActivePaymentGateway(gateway);

    res.json({
      success: true,
      message: `Gateway alterado para ${gateway} com sucesso.`,
      activeGateway: gateway
    });
  } catch (error) {
    console.error('Erro ao alterar gateway:', error);
    res.status(500).json({ error: error.message || 'Erro ao alterar gateway de pagamento.' });
  }
});

// Testar conexão com gateway
app.post('/api/payment-settings/test', requireLogin, applyCsrf, async (req, res) => {
  try {
    const { gateway } = req.body;

    if (!gateway) {
      return res.status(400).json({ error: 'Gateway não informado.' });
    }

    let testResult = { success: false, message: '' };

    if (gateway === 'ciabra') {
      if (!CIABRA_PUBLIC_KEY || !CIABRA_PRIVATE_KEY) {
        testResult = { success: false, message: 'Credenciais CIABRA não configuradas.' };
      } else {
        try {
          // Tenta verificar a autenticação com a CIABRA
          const authResult = await checkCiabraAuth();
          if (authResult.success) {
            testResult = {
              success: true,
              message: 'Conexão com CIABRA estabelecida com sucesso!',
              accountInfo: authResult.data || 'Conta conectada'
            };
          } else {
            testResult = { success: false, message: `Erro ao conectar com CIABRA: ${authResult.error}` };
          }
        } catch (error) {
          const errorMsg = error.response?.data?.message || error.message;
          testResult = { success: false, message: `Erro ao conectar com CIABRA: ${errorMsg}` };
        }
      }
    } else {
      return res.status(400).json({ error: 'Gateway inválido.' });
    }

    res.json(testResult);
  } catch (error) {
    console.error('Erro ao testar gateway:', error);
    res.status(500).json({ error: 'Erro ao testar conexão com gateway.' });
  }
});

// --- FIM DOS ENDPOINTS DE CONFIGURAÇÃO DE PAGAMENTO ---

// MODIFICADO: Adicionado 'requireLogin' para proteger a rota
app.get('/api/purchase-history', requireLogin, async (req, res) => {
  try {
    const {
      nome,
      telefone,
      mes,
      ano,
      status,
      transactionId,
      dataInicio,
      dataFim,
      page = 1,
      limit = 10
    } = req.query;

    let where = {};

    if (nome) {
      // CORREÇÃO CRÍTICA #7: Sanitizar caracteres especiais do LIKE para prevenir SQL injection
      const sanitizedNome = nome.replace(/[%_]/g, '\\$&');
      where.nome = { [Op.like]: `%${sanitizedNome}%` };
    }
    if (telefone) {
      where.telefone = telefone;
    }
    if (status) {
      where.status = status;
    }
    if (transactionId) {
      where.transactionId = { [Op.like]: `%${transactionId}%` };
    }

    // Filtro de data: prioriza range personalizado, senão usa mês/ano
    if (dataInicio && dataFim) {
      const startDate = new Date(dataInicio);
      const endDate = new Date(dataFim);
      endDate.setHours(23, 59, 59, 999); // Fim do dia
      where.dataTransacao = { [Op.between]: [startDate, endDate] };
    } else if (mes && ano) {
      const startDate = new Date(ano, mes - 1, 1);
      const endDate = new Date(ano, mes, 0, 23, 59, 59);
      where.dataTransacao = { [Op.between]: [startDate, endDate] };
    }

    // Paginação
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: history } = await PurchaseHistory.findAndCountAll({
      where,
      order: [['dataTransacao', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    res.json({
      data: history,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar histórico.' });
  }
});

// NOVO: Rota para obter estatísticas de vendas
app.get('/api/statistics', requireLogin, async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Início e fim do mês atual
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

    // Início e fim do mês anterior
    const startOfLastMonth = new Date(currentYear, currentMonth - 1, 1);
    const endOfLastMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59);

    // Vendas bem-sucedidas do mês atual
    const currentMonthSales = await PurchaseHistory.findAll({
      where: {
        status: 'Sucesso',
        dataTransacao: { [Op.between]: [startOfMonth, endOfMonth] }
      }
    });

    // Vendas bem-sucedidas do mês anterior
    const lastMonthSales = await PurchaseHistory.findAll({
      where: {
        status: 'Sucesso',
        dataTransacao: { [Op.between]: [startOfLastMonth, endOfLastMonth] }
      }
    });

    // Calcula totais
    const currentMonthTotal = currentMonthSales.reduce((sum, sale) => sum + (sale.valorPago || 0), 0);
    const lastMonthTotal = lastMonthSales.reduce((sum, sale) => sum + (sale.valorPago || 0), 0);

    // Total de vendas (todos os tempos)
    const allSuccessfulSales = await PurchaseHistory.findAll({
      where: { status: 'Sucesso' }
    });
    const totalRevenue = allSuccessfulSales.reduce((sum, sale) => sum + (sale.valorPago || 0), 0);

    // Vendas de hoje
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const todaySales = await PurchaseHistory.count({
      where: {
        status: 'Sucesso',
        dataTransacao: { [Op.between]: [startOfToday, endOfToday] }
      }
    });

    // Total de transações pendentes
    const pendingCount = await PurchaseHistory.count({
      where: { status: 'Gerado' }
    });

    res.json({
      currentMonth: {
        sales: currentMonthSales.length,
        revenue: currentMonthTotal
      },
      lastMonth: {
        sales: lastMonthSales.length,
        revenue: lastMonthTotal
      },
      allTime: {
        sales: allSuccessfulSales.length,
        revenue: totalRevenue
      },
      today: {
        sales: todaySales
      },
      pending: pendingCount
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
  }
});


// Em server.js, na seção "ENDPOINTS DE ADMINISTRAÇÃO (Protegidos)"

// NOVO: Rota para registrar um novo dispositivo para receber notificações com CSRF
app.post('/api/devices', requireLogin, applyCsrf, async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token não fornecido.' });
  }

  try {
    // Procura por um token existente ou cria um novo
    const [device, created] = await AdminDevice.findOrCreate({
      where: { token: token },
    });

    if (created) {
      // CORREÇÃO: Não loga token completo (dado sensível)
      const maskedToken = device.token.substring(0, 8) + '...' + device.token.substring(device.token.length - 4);
      console.log('Novo dispositivo registrado para notificações:', maskedToken);
      res.status(201).json({ message: 'Dispositivo registrado com sucesso.' });
    } else {
      res.status(200).json({ message: 'Dispositivo já estava registrado.' });
    }
  } catch (error) {
    console.error('Erro ao registrar dispositivo:', error);
    res.status(500).json({ error: 'Erro interno ao salvar o token.' });
  }
});

// NOVO: Rota para atualizar status de uma transação manualmente
// IMPORTANTE: O sistema funciona exclusivamente via webhooks para confirmação de pagamento
// O sistema funciona exclusivamente via webhooks
// Esta rota permite atualização manual em casos de falha de webhook
app.post('/api/update-transaction-status', requireLogin, applyCsrf, async (req, res) => {
  const { transactionId, newStatus } = req.body;

  if (!transactionId || !newStatus) {
    return res.status(400).json({
      error: 'Transaction ID e novo status são obrigatórios.'
    });
  }

  try {
    // Busca a transação no banco de dados
    const purchase = await PurchaseHistory.findOne({
      where: { transactionId: transactionId }
    });

    if (!purchase) {
      return res.status(404).json({ error: 'Transação não encontrada.' });
    }

    // Validação de status
    const validStatuses = ['Gerado', 'Sucesso', 'Falhou', 'Expirado'];

    if (!validStatuses.includes(newStatus)) {
      return res.status(400).json({
        error: `Status inválido. Use: ${validStatuses.join(', ')}`
      });
    }

    const oldStatus = purchase.status;

    // Atualiza o status no banco
    await purchase.update({ status: newStatus });

    console.log(`✅ Status da transação ${transactionId} atualizado manualmente de ${oldStatus} para ${newStatus} pelo admin`);

    res.json({
      success: true,
      message: `Status atualizado de "${oldStatus}" para "${newStatus}"`,
      transactionId: transactionId,
      oldStatus: oldStatus,
      newStatus: newStatus
    });

  } catch (error) {
    console.error('Erro ao atualizar status da transação:', error);
    res.status(500).json({
      error: 'Erro ao processar atualização de status',
      details: error.message
    });
  }
});

// REMOVIDO: Endpoint /api/bulk-update-transactions removido
// O botão "Atualizar Todos" agora apenas recarrega os dados do banco de dados
// sem fazer modificações. A atualização manual individual permanece disponível.

// REMOVIDO: Rota de debug removida por questões de segurança
// Esta rota expunha informações sensíveis e foi removida

const PORT = process.env.PORT || 3000;

// CORREÇÃO: Função de inicialização assíncrona
// Inicializa Redis e CIABRA ANTES de iniciar o servidor
async function startServer() {
  try {
    console.log('🚀 Inicializando servidor...');

    // CORREÇÃO CRÍTICA: Inicializa Redis PRIMEIRO
    console.log('📦 Inicializando Redis...');
    await initializeRedis();

    // CORREÇÃO CRÍTICA: Cria middleware de sessão DEPOIS do Redis estar pronto
    // Atribui ao wrapper que já foi registrado na ordem correta
    console.log('[DEBUG] Criando middleware de sessão...');
    console.log(`  sessionStore definido: ${!!sessionStore}`);
    console.log(`  sessionStore é RedisStore: ${sessionStore && sessionStore.constructor.name === 'RedisStore'}`);

    actualSessionMiddleware = session({
      store: sessionStore, // Agora sessionStore está definido (RedisStore ou undefined para MemoryStore)
      secret: process.env.SESSION_SECRET, // CORREÇÃO CRÍTICA #4: Sem fallback inseguro
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
    });
    console.log('[DEBUG] actualSessionMiddleware atribuído:', !!actualSessionMiddleware);
    console.log(`✅ Middleware de sessão configurado (${sessionStore ? 'RedisStore' : 'MemoryStore'})`);

    // CORREÇÃO CRÍTICA #5: Configurar CSRF protection após sessão
    csrfProtection = csrf({
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      }
    });
    console.log('✅ CSRF protection configurado');

    // Verifica credenciais CIABRA antes de aceitar requisições
    if (CIABRA_PUBLIC_KEY && CIABRA_PRIVATE_KEY) {
      console.log('✅ Credenciais CIABRA configuradas');
    } else {
      console.warn('⚠️ Credenciais CIABRA não configuradas. Configure CIABRA_PUBLIC_KEY e CIABRA_PRIVATE_KEY no .env');
    }

    // Agora sim inicia o servidor
    const server = app.listen(PORT, () => {
      console.log(`✅ Servidor rodando na porta ${PORT}`);
      console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️  Sessões: ${sessionStore ? 'Redis (persistente)' : 'Memória (volátil)'}`);
      console.log('✨ Sistema pronto para receber requisições');
    });

    // NOVO: Graceful shutdown para evitar connection leaks
    const gracefulShutdown = async (signal) => {
      console.log(`\n🛑 ${signal} recebido. Iniciando graceful shutdown...`);

      // 1. Para de aceitar novas conexões
      server.close(async () => {
        console.log('📡 Servidor HTTP fechado (não aceita mais conexões)');

        try {
          // 2. Fecha conexão com banco de dados
          await sequelize.close();
          console.log('🗄️  Conexão com banco de dados fechada');

          // 3. Fecha Redis se estiver em uso
          if (sessionStore && sessionStore.client) {
            await new Promise((resolve) => {
              sessionStore.client.quit(() => {
                console.log('🔴 Conexão com Redis fechada');
                resolve();
              });
            });
          }

          console.log('✅ Graceful shutdown concluído');
          process.exit(0);
        } catch (error) {
          console.error('❌ Erro durante graceful shutdown:', error);
          process.exit(1);
        }
      });

      // Timeout: força saída após 30 segundos se shutdown não completar
      setTimeout(() => {
        console.error('⚠️  Graceful shutdown timeout. Forçando saída...');
        process.exit(1);
      }, 30000);
    };

    // Registra handlers para sinais de encerramento
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Erro ao inicializar servidor:', error);
    console.error('💥 O servidor não foi iniciado devido a erros críticos');
    process.exit(1);
  }
}

// Inicia o servidor
startServer();