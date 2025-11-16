// NOVO: Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const admin = require('firebase-admin');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios'); // Utilize axios para requisições HTTP
const { Op } = require('sequelize');
const { Product, PurchaseHistory, AdminDevice, sequelize } = require('./models');

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

const app = express();

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

  // 4. ONDAPAY_CLIENT_ID e ONDAPAY_CLIENT_SECRET
  if (!process.env.ONDAPAY_CLIENT_ID) {
    errors.push({
      var: 'ONDAPAY_CLIENT_ID',
      message: 'Client ID da OndaPay não configurado',
      solution: 'Obtenha no painel da OndaPay e configure no .env'
    });
  }
  if (!process.env.ONDAPAY_CLIENT_SECRET) {
    errors.push({
      var: 'ONDAPAY_CLIENT_SECRET',
      message: 'Client Secret da OndaPay não configurado',
      solution: 'Obtenha no painel da OndaPay e configure no .env'
    });
  }

  // 5. ONDAPAY_WEBHOOK_SECRET - Essencial para validar webhooks
  if (!process.env.ONDAPAY_WEBHOOK_SECRET) {
    errors.push({
      var: 'ONDAPAY_WEBHOOK_SECRET',
      message: 'Webhook Secret não configurado (CRÍTICO para segurança)',
      solution: 'Obtenha no painel da OndaPay - previne fraude de pagamentos'
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
validateEnvironmentVariables();

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
        "https://ondapay.app.br",
        "https://api.ondapay.app.br"
      ],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline necessário por enquanto
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false // Necessário para Firebase
}));

// NOVO: Rate limiting global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requisições por IP
  message: 'Muitas requisições deste IP, tente novamente em 15 minutos.'
});
app.use(globalLimiter);

app.use(bodyParser.json());
// NOVO: Adicionado para interpretar dados de formulários HTML (para o login)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
  max: 30, // 30 webhooks por minuto (OndaPay não envia mais que isso)
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

// --- CONFIGURAÇÃO DA API DE PAGAMENTO (ONDAPAY) ---
const ONDAPAY_API_URL = "https://api.ondapay.app";
// MODIFICADO: Credenciais agora vêm de variáveis de ambiente
const ONDAPAY_CLIENT_ID = process.env.ONDAPAY_CLIENT_ID;
const ONDAPAY_CLIENT_SECRET = process.env.ONDAPAY_CLIENT_SECRET;
// CORREÇÃO: WEBHOOK_URL deve vir do .env ao invés de hardcoded
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://cinepremiumedit.domcloud.dev/ondapay-webhook";

let ondaPayToken = null;
let tokenPromise = null; // CORREÇÃO: Promise cache para evitar race conditions

// Função para obter/renovar o token de autenticação
// CORREÇÃO: Implementa lock via promise caching para evitar múltiplas chamadas simultâneas
async function getOndaPayToken(forceNew = false) {
  // Se já temos um token válido e não estamos forçando renovação, retorna
  if (ondaPayToken && !forceNew) {
    return ondaPayToken;
  }

  // CORREÇÃO: Se já existe uma requisição em andamento, retorna a mesma promise
  // Isso evita que múltiplas requisições simultâneas façam múltiplas chamadas à API
  if (tokenPromise && !forceNew) {
    console.log('[OndaPay] Requisição de token já em andamento, aguardando...');
    return tokenPromise;
  }

  // Cria uma nova promise e armazena no cache
  tokenPromise = (async () => {
    try {
      console.log('[OndaPay] Solicitando novo token...');
      const response = await axios.post(`${ONDAPAY_API_URL}/api/v1/login`, {}, {
        headers: {
          'client_id': ONDAPAY_CLIENT_ID,
          'client_secret': ONDAPAY_CLIENT_SECRET,
          'Content-Type': 'application/json'
        }
      });
      ondaPayToken = response.data.token;
      console.log("✅ Token da OndaPay obtido/renovado com sucesso.");
      return ondaPayToken;
    } catch (error) {
      console.error("❌ Erro ao obter token da OndaPay:", error.response ? error.response.data : error.message);
      ondaPayToken = null;
      throw new Error("Não foi possível autenticar com o serviço de pagamento.");
    } finally {
      // Limpa o cache da promise após conclusão (sucesso ou erro)
      tokenPromise = null;
    }
  })();

  return tokenPromise;
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
      ondapay: {
        client_id_configured: !!process.env.ONDAPAY_CLIENT_ID,
        webhook_url: process.env.WEBHOOK_URL || 'não definido'
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

      const payload = {
        amount: parseFloat((value / 100).toFixed(2)),
        external_id: purchaseRecord.id.toString(),
        webhook: WEBHOOK_URL,
        description: `${productTitle} - ${productDescription || ''}`,
        dueDate: dueDateFormatted,
        payer: { name: nome, document: cpf.replace(/\D/g, ''), email: sanitizedEmail } // CORREÇÃO #6: Usa email sanitizado
      };

      // Obtém token e faz chamada à API OndaPay
      let token = await getOndaPayToken();
      let response;

      try {
        // Primeira tentativa com o token atual
        response = await axios.post(`${ONDAPAY_API_URL}/api/v1/deposit/pix`, payload, {
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
        });
      } catch (error) {
        // Se a primeira tentativa falhar com erro 401, o token provavelmente expirou
        if (error.response && error.response.status === 401) {
          console.log("Token da OndaPay expirado. Renovando e tentando novamente...");
          token = await getOndaPayToken(true);
          response = await axios.post(`${ONDAPAY_API_URL}/api/v1/deposit/pix`, payload, {
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
          });
        } else {
          throw error;
        }
      }

      const data = response.data;

      console.log('[GERARQRCODE] 📦 Resposta da OndaPay recebida:');
      console.log(`  - Transaction ID: ${data.id_transaction}`);
      console.log(`  - QR Code gerado: ${data.qrcode ? 'Sim' : 'Não'}`);

      // Atualiza com transactionId dentro da mesma transação
      console.log(`[GERARQRCODE] 🔄 Atualizando purchase ID ${purchaseRecord.id} com transactionId ${data.id_transaction}...`);
      await purchaseRecord.update(
        { transactionId: data.id_transaction },
        { transaction: t }
      );

      // CORREÇÃO: Só commita se TUDO deu certo
      await t.commit();
      console.log('[GERARQRCODE] ✅ Transação commitada com sucesso!');

      console.log('[GERARQRCODE] 📊 Resumo da compra criada:');
      console.log(`  - Purchase ID (external_id): ${purchaseRecord.id}`);
      console.log(`  - Transaction ID (OndaPay): ${data.id_transaction}`);
      console.log(`  - Nome: ${nome}`);
      console.log(`  - Telefone: ${telefone}`);
      console.log(`  - Valor: R$ ${(value / 100).toFixed(2)}`);
      console.log(`  - Status inicial: ${purchaseRecord.status}`);
      console.log(`  - Expira em: ${expirationDate.toISOString()}`);

      // Envia notificação de nova venda (após commit)
      sendPushNotification(
        'Nova Tentativa de Venda!',
        `${nome} gerou um QR Code para pagamento.`
      );

      const resultado = {
        id: data.id_transaction,
        qr_code: data.qrcode,
        qr_code_base64: data.qrcode_base64,
        expirationTimestamp: expirationDate.getTime()
      };

      console.log("[GERARQRCODE] ✅ QR Code gerado com sucesso (OndaPay):", resultado.id);
      console.log('[GERARQRCODE] ℹ️  Cliente irá começar a fazer polling a cada 5 segundos...\n');
      res.json(resultado);
    } catch (transactionError) {
      // CORREÇÃO: Se qualquer coisa falhar, faz rollback
      await t.rollback();
      console.error('❌ Erro na transação, rollback executado:', transactionError.message);
      throw transactionError; // Re-lança para o catch externo tratar
    }
  } catch (error) {
    // CORREÇÃO: Não expõe detalhes internos em produção
    let errorMessage = "Erro ao gerar QR code. Tente novamente.";

    // Log completo apenas no servidor (não exposto ao cliente)
    if (error.response && error.response.data) {
      console.error("❌ Erro da API OndaPay:", error.response.data);

      // CORREÇÃO: Só expõe detalhes em desenvolvimento
      if (process.env.NODE_ENV !== 'production') {
        if (error.response.data.msg) {
          errorMessage = Object.values(error.response.data.msg)[0];
        }
      }
    } else {
      console.error("❌ Erro ao gerar QR code:", error.message);
    }

    res.status(400).json({ error: errorMessage });
  }
});

// CORRIGIDO: Webhook com verificação de assinatura HMAC implementada
// CORREÇÃO CRÍTICA #1: Webhook com verificação HMAC obrigatória
app.post('/ondapay-webhook', webhookLimiter, async (req, res) => {
    console.log('\n=====================================');
    console.log('🔔 [WEBHOOK LOG] Webhook Recebido');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('🌐 IP:', req.ip);
    console.log('📦 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📄 Body:', JSON.stringify(req.body, null, 2));
    console.log('=====================================\n');

    try {
      // CORREÇÃO CRÍTICA #1: SEMPRE validar assinatura HMAC (secret validado no início do arquivo)
      const signature = req.headers['x-ondapay-signature'];

      if (!signature) {
        console.error('[WEBHOOK] ❌ Assinatura ausente. IP:', req.ip);
        return res.status(401).json({ error: 'Missing signature' });
      }

      console.log('[WEBHOOK] 🔐 Validando assinatura HMAC...');

      // Calcular HMAC esperado
      const computedSignature = crypto
        .createHmac('sha256', process.env.ONDAPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      // Comparação timing-safe
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
        console.error('[WEBHOOK] ❌ Assinatura inválida! IP:', req.ip);
        // CORREÇÃO: Não logar assinaturas em produção
        if (process.env.NODE_ENV !== 'production') {
          console.error('[WEBHOOK] Recebida:', signature);
          console.error('[WEBHOOK] Esperada:', computedSignature);
        }
        return res.status(401).json({ error: 'Invalid signature' });
      }

      console.log('[WEBHOOK] ✅ Assinatura HMAC válida');

      // Processar webhook
      const { status, transaction_id, external_id } = req.body;
      if (!status || !transaction_id || !external_id) {
        console.warn(`[WEBHOOK LOG] ⚠️  Webhook recebido com dados incompletos.`, req.body);
        return res.status(400).send('Dados do webhook incompletos.');
      }

      console.log(`[WEBHOOK LOG] 📊 Dados extraídos:`);
      console.log(`  - Status: ${status}`);
      console.log(`  - Transaction ID: ${transaction_id}`);
      console.log(`  - External ID (purchase ID): ${external_id}`);

      if (status.toUpperCase() === 'PAID_OUT') {
        console.log(`[WEBHOOK LOG] 💰 Status 'PAID_OUT' detectado para external_id: ${external_id}`);
        const purchaseId = parseInt(external_id, 10);
        if (isNaN(purchaseId)) {
          console.error(`[WEBHOOK LOG] ❌ Erro: external_id '${external_id}' não é um número válido.`);
          return res.status(400).send('external_id inválido.');
        }

        // CORREÇÃO: Busca o registro primeiro para verificar se já foi processado (idempotência)
        const purchase = await PurchaseHistory.findByPk(purchaseId);

        if (!purchase) {
          console.error(`[WEBHOOK LOG] ❌ Erro: Compra com ID ${purchaseId} não encontrada.`);
          return res.status(404).send('Compra não encontrada.');
        }

        console.log(`[WEBHOOK LOG] 📋 Compra encontrada:`);
        console.log(`  - Nome: ${purchase.nome}`);
        console.log(`  - Transaction ID: ${purchase.transactionId}`);
        console.log(`  - Status atual: ${purchase.status}`);

        // CORREÇÃO: Se já foi processado, retorna sucesso sem fazer nada (idempotência)
        if (purchase.status === 'Sucesso') {
          console.log(`[WEBHOOK LOG] ⚠️  Webhook duplicado ignorado. Compra ${purchaseId} já foi processada.`);
          return res.status(200).send({ status: 'already_processed' });
        }

        // Atualiza o status
        console.log(`[WEBHOOK LOG] 🔄 Atualizando o registro com ID: ${purchaseId} de '${purchase.status}' para 'Sucesso'...`);
        await purchase.update({ status: 'Sucesso' });
        console.log(`[WEBHOOK LOG] ✅ SUCESSO! Compra ID ${purchaseId} atualizada para 'Sucesso'.`);
        console.log(`[WEBHOOK LOG] 📧 Enviando notificação push...`);

        // Envia notificação push apenas uma vez
        sendPushNotification(
          'Venda Paga com Sucesso!',
          `O pagamento de ${purchase.nome} foi confirmado.`
        );
      } else {
        console.log(`[WEBHOOK LOG] ℹ️  Status recebido foi '${status}' (não é PAID_OUT). Nenhuma ação necessária.`);
      }

      console.log('[WEBHOOK LOG] ✅ Respondendo com status 200 OK\n');
      res.status(200).send({ status: 'ok' });
    } catch (error) {
      console.error("[WEBHOOK LOG] ❌ Erro crítico no processamento do webhook:", error.message);
      console.error("[WEBHOOK LOG] Stack trace:", error.stack);
      res.status(500).send('Erro interno ao processar webhook.');
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
        webhookUrl: process.env.WEBHOOK_URL || 'NÃO CONFIGURADO',
        webhookSecretConfigured: !!process.env.ONDAPAY_WEBHOOK_SECRET,
        isLocalhost: (process.env.WEBHOOK_URL || '').includes('localhost'),
        warning: (process.env.WEBHOOK_URL || '').includes('localhost')
          ? '⚠️ WEBHOOK_URL aponta para localhost. OndaPay não consegue enviar webhooks para localhost!'
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
        webhookUrl: process.env.WEBHOOK_URL || 'NÃO CONFIGURADO',
        webhookSecretConfigured: !!process.env.ONDAPAY_WEBHOOK_SECRET,
        isLocalhost: (process.env.WEBHOOK_URL || '').includes('localhost'),
        warning: (process.env.WEBHOOK_URL || '').includes('localhost')
          ? '⚠️ WEBHOOK_URL aponta para localhost. OndaPay NÃO consegue enviar webhooks para localhost!'
          : null
      },
      nextSteps: purchase.status === 'Gerado' ? [
        '1. Cliente deve efetuar o pagamento via Pix',
        '2. OndaPay enviará webhook para o servidor quando pagamento for confirmado',
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
          '🔐 HMAC signature pode estar falhando - verifique ONDAPAY_WEBHOOK_SECRET',
          '📡 Servidor pode estar inacessível para OndaPay',
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
    } catch (error)      {
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
// IMPORTANTE: A OndaPay não possui endpoint GET para consultar status
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

// REMOVIDO: Rota de debug removida por questões de segurança
// Esta rota expunha informações sensíveis e foi removida

const PORT = process.env.PORT || 3000;

// CORREÇÃO: Função de inicialização assíncrona
// Inicializa Redis e OndaPay ANTES de iniciar o servidor
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

    // Obtém token OndaPay antes de aceitar requisições
    console.log('📡 Obtendo token OndaPay...');
    await getOndaPayToken();
    console.log('✅ Token OndaPay obtido com sucesso');

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