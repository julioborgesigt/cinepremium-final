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
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

// NOVO: Dependências de segurança
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();

// CRÍTICO: Confiar no proxy reverso (necessário para domcloud.co, heroku, etc)
// Isso permite que o Express reconheça HTTPS quando atrás de um proxy
app.set('trust proxy', 1);

// CORREÇÃO: Validação de CORS em produção
if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
  console.error('❌ ERRO CRÍTICO: ALLOWED_ORIGINS não está definido em produção!');
  console.error('Configure ALLOWED_ORIGINS no .env com os domínios permitidos.');
  console.error('Exemplo: ALLOWED_ORIGINS=https://seu-dominio.com,https://www.seu-dominio.com');
  process.exit(1);
}

// NOVO: Configuração do CORS
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()) // CORREÇÃO: Trim nos domínios
    : true, // Em desenvolvimento, permite todas as origens
  credentials: true, // Permite cookies
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// NOVO: Configuração do Helmet para segurança
app.use(helmet({
  contentSecurityPolicy: false, // Desabilitado temporariamente para Firebase funcionar
  crossOriginEmbedderPolicy: false
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

    // CORREÇÃO: Conecta ao Redis e aguarda antes de criar o store
    redisClient.connect()
      .then(() => {
        // Cria sessionStore DEPOIS que Redis conectar
        sessionStore = new RedisStore({
          client: redisClient,
          prefix: 'cinepremium:sess:',
          ttl: 8 * 60 * 60 // 8 horas em segundos
        });
        console.log('✅ RedisStore configurado');
      })
      .catch(err => {
        console.error('❌ Falha ao conectar ao Redis:', err);
        console.warn('⚠️ Usando MemoryStore como fallback (NÃO RECOMENDADO EM PRODUÇÃO)');
        redisClient = null;
        sessionStore = null;
      });
  } catch (error) {
    console.error('❌ Erro ao configurar Redis:', error);
    console.warn('⚠️ Usando MemoryStore como fallback (NÃO RECOMENDADO EM PRODUÇÃO)');
  }
} else {
  console.warn('⚠️ Usando MemoryStore para sessões (apenas desenvolvimento)');
  console.warn('💡 Para produção, configure REDIS_URL no .env');
}

// NOVO: Configuração do middleware de sessão
app.use(cookieParser());
app.use(session({
  store: sessionStore, // CORREÇÃO: Usa RedisStore se disponível, senão MemoryStore
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

    if (response.failureCount > 0) {
      response.responses.forEach(resp => {
        if (!resp.success) {
          console.error('[PUSH LOG] Detalhe da falha:', resp.error);
        }
      });
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
  // CORREÇÃO: Só loga dados sensíveis em desenvolvimento
  if (process.env.NODE_ENV !== 'production') {
    console.log('[REQUIRE_LOGIN] Path:', req.path);
    console.log('[REQUIRE_LOGIN] Session ID:', req.sessionID);
    console.log('[REQUIRE_LOGIN] Session loggedin:', req.session.loggedin);
    console.log('[REQUIRE_LOGIN] Cookies:', req.cookies);
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

// MODIFICADO: Rota de autenticação com suporte a bcrypt
app.post('/auth', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  console.log('[AUTH] Tentativa de login para usuário:', username);
  // CORREÇÃO: Não loga Session ID em produção
  if (process.env.NODE_ENV !== 'production') {
    console.log('[AUTH] Session ID antes do login:', req.sessionID);
  }

  try {
    // Valida username
    if (username !== process.env.ADMIN_USER) {
      console.log('[AUTH] Username incorreto');
      return res.redirect('/login?error=1');
    }

    // Verifica se a senha está em formato de hash bcrypt (começa com $2b$ ou $2a$)
    const passwordHash = process.env.ADMIN_PASS;
    let isPasswordValid = false;

    if (passwordHash && (passwordHash.startsWith('$2b$') || passwordHash.startsWith('$2a$'))) {
      // Senha está em formato bcrypt hash
      isPasswordValid = await bcrypt.compare(password, passwordHash);
      // CORREÇÃO: Não loga resultado de verificação em produção
      if (process.env.NODE_ENV !== 'production') {
        console.log('[AUTH] Verificação bcrypt:', isPasswordValid);
      }
    } else {
      // Backward compatibility: senha em texto plano
      console.warn('⚠️ AVISO: Senha do admin está em texto plano. Use bcrypt para maior segurança.');
      isPasswordValid = (password === passwordHash);
      // CORREÇÃO: Não loga resultado de verificação em produção
      if (process.env.NODE_ENV !== 'production') {
        console.log('[AUTH] Verificação texto plano:', isPasswordValid);
      }
    }

    if (isPasswordValid) {
      // CORREÇÃO: Regenera o session ID para prevenir session fixation
      req.session.regenerate((err) => {
        if (err) {
          console.error('[AUTH] Erro ao regenerar sessão:', err);
          return res.redirect('/login?error=1');
        }

        // Define a sessão como logada
        req.session.loggedin = true;

        // Salva a sessão
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('[AUTH] Erro ao salvar sessão:', saveErr);
            return res.redirect('/login?error=1');
          }
          console.log('[AUTH] ✅ Login bem-sucedido');
          // CORREÇÃO: Não loga Session ID em produção
          if (process.env.NODE_ENV !== 'production') {
            console.log('[AUTH] Novo Session ID:', req.sessionID);
            console.log('[AUTH] Session loggedin:', req.session.loggedin);
          }
          res.redirect('/admin');
        });
      });
    } else {
      console.log('[AUTH] Senha incorreta');
      res.redirect('/login?error=1');
    }
  } catch (error) {
    console.error('[AUTH] Erro na autenticação:', error);
    res.redirect('/login?error=1');
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

// Endpoint para gerar QR Code de pagamento
// MODIFICADO: A rota de gerar QR Code agora tem a lógica de renovação de token
app.post('/gerarqrcode', async (req, res) => {
  try {
    const { value, nome, telefone, cpf, email, productTitle, productDescription } = req.body;

    // NOVO: Validações aprimoradas no backend
    if (!value || !nome || !telefone || !cpf || !email) {
      return res.status(400).json({ error: "Todos os campos, incluindo e-mail, são obrigatórios." });
    }

    // Validar CPF
    if (!isValidCPF(cpf)) {
      return res.status(400).json({ error: "CPF inválido. Por favor, verifique o número digitado." });
    }

    // Validar e-mail
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "E-mail inválido. Por favor, verifique o endereço digitado." });
    }

    // Validar telefone
    if (!isValidPhone(telefone)) {
      return res.status(400).json({ error: "Telefone inválido. Deve conter 11 dígitos (DDD + número)." });
    }

    // Validar valor do produto
    if (isNaN(value) || value <= 0) {
      return res.status(400).json({ error: "Valor do produto inválido." });
    }

    // Validar nome (mínimo 3 caracteres)
    if (nome.trim().length < 3) {
      return res.status(400).json({ error: "Nome deve ter no mínimo 3 caracteres." });
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
        { nome, telefone, status: 'Gerado' },
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
        payer: { name: nome, document: cpf.replace(/\D/g, ''), email: email }
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

      // Atualiza com transactionId dentro da mesma transação
      await purchaseRecord.update(
        { transactionId: data.id_transaction },
        { transaction: t }
      );

      // CORREÇÃO: Só commita se TUDO deu certo
      await t.commit();

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

      console.log("✅ QR Code gerado (OndaPay):", resultado.id);
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
app.post('/ondapay-webhook', async (req, res) => {
    console.log('--- [WEBHOOK LOG] --- Webhook Recebido. Corpo da requisição:');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('--- [WEBHOOK LOG] --- Fim do corpo da requisição.');

    // Verificação de assinatura HMAC
    if (process.env.ONDAPAY_WEBHOOK_SECRET) {
      const signature = req.headers['x-ondapay-signature'];

      if (!signature) {
        console.error('[WEBHOOK LOG] Assinatura não fornecida no header. Possível tentativa de fraude.');
        return res.status(401).send('Assinatura não fornecida.');
      }

      const crypto = require('crypto');
      const computedSignature = crypto
        .createHmac('sha256', process.env.ONDAPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      // Comparação segura contra timing attacks
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
        console.error('[WEBHOOK LOG] Assinatura inválida! Possível tentativa de fraude.');
        console.error('[WEBHOOK LOG] Assinatura recebida:', signature);
        console.error('[WEBHOOK LOG] Assinatura esperada:', computedSignature);
        return res.status(401).send('Assinatura inválida.');
      }

      console.log('[WEBHOOK LOG] Assinatura verificada com sucesso.');
    } else {
      console.warn('[WEBHOOK LOG] ⚠️ AVISO: ONDAPAY_WEBHOOK_SECRET não está configurado. Webhook NÃO ESTÁ SEGURO!');
    }

    try {
      const { status, transaction_id, external_id } = req.body;
      if (!status || !transaction_id || !external_id) {
        console.warn(`[WEBHOOK LOG] Webhook recebido com dados incompletos.`, req.body);
        return res.status(400).send('Dados do webhook incompletos.');
      }
  
      if (status.toUpperCase() === 'PAID_OUT') {
        console.log(`[WEBHOOK LOG] Status 'PAID_OUT' detectado para external_id: ${external_id}`);
        const purchaseId = parseInt(external_id, 10);
        if (isNaN(purchaseId)) {
          console.error(`[WEBHOOK LOG] Erro: external_id '${external_id}' não é um número válido.`);
          return res.status(400).send('external_id inválido.');
        }

        // CORREÇÃO: Busca o registro primeiro para verificar se já foi processado (idempotência)
        const purchase = await PurchaseHistory.findByPk(purchaseId);

        if (!purchase) {
          console.error(`[WEBHOOK LOG] Erro: Compra com ID ${purchaseId} não encontrada.`);
          return res.status(404).send('Compra não encontrada.');
        }

        // CORREÇÃO: Se já foi processado, retorna sucesso sem fazer nada (idempotência)
        if (purchase.status === 'Sucesso') {
          console.log(`[WEBHOOK LOG] Webhook duplicado ignorado. Compra ${purchaseId} já foi processada.`);
          return res.status(200).send({ status: 'already_processed' });
        }

        // Atualiza o status
        console.log(`[WEBHOOK LOG] Atualizando o registro com ID: ${purchaseId} para 'Sucesso'.`);
        await purchase.update({ status: 'Sucesso' });
        console.log(`[WEBHOOK LOG] SUCESSO! Compra ID ${purchaseId} atualizada.`);

        // Envia notificação push apenas uma vez
        sendPushNotification(
          'Venda Paga com Sucesso!',
          `O pagamento de ${purchase.nome} foi confirmado.`
        );
      } else {
        console.log(`[WEBHOOK LOG] Status recebido foi '${status}'. Nenhuma ação necessária.`);
      }
      res.status(200).send({ status: 'ok' });
    } catch (error) {
      console.error("[WEBHOOK LOG] Erro crítico no processamento do webhook:", error.message);
      res.status(500).send('Erro interno ao processar webhook.');
    }
  });

// Endpoint para o cliente verificar o status do pagamento
app.post('/check-local-status', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "ID da transação não fornecido." });
  
      const purchase = await PurchaseHistory.findOne({ where: { transactionId: id } });
  
      if (!purchase) {
        console.log(`[STATUS CHECK] Nenhuma compra encontrada para o transactionId: ${id}. Retornando 'Gerado'.`);
        return res.json({ id: id, status: 'Gerado' });
      }
      
      console.log(`[STATUS CHECK] Status para transactionId ${id} é '${purchase.status}'. Enviando para o cliente.`);
      res.json({ id: purchase.transactionId, status: purchase.status });
  
    } catch (error) {
      console.error("[STATUS CHECK] Erro ao verificar status local:", error.message);
      res.status(500).json({ error: "Erro ao verificar status localmente" });
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

// MODIFICADO: Adicionado 'requireLogin' para proteger a rota
app.post('/api/products', requireLogin, async (req, res) => {
    try {
      const { title, price, image, description } = req.body;

      // Validações aprimoradas
      if (!title || !price || !image) {
        return res.status(400).json({ error: 'Título, preço e imagem são obrigatórios.' });
      }

      // NOVO: Validar que o preço é um número positivo
      const priceNum = parseInt(price);
      if (isNaN(priceNum) || priceNum <= 0) {
        return res.status(400).json({ error: 'Preço deve ser um número positivo maior que zero.' });
      }

      // NOVO: Validar tamanho da imagem (limite de 1MB em base64)
      if (image.length > 1500000) { // ~1MB em base64
        return res.status(400).json({ error: 'Imagem muito grande. O tamanho máximo é 1MB.' });
      }

      // NOVO: Validar que o título tem no mínimo 3 caracteres
      if (title.trim().length < 3) {
        return res.status(400).json({ error: 'Título deve ter no mínimo 3 caracteres.' });
      }

      const product = await Product.create({ title, price: priceNum, image, description });
      res.json(product);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar produto.' });
    }
});
  
// MODIFICADO: Adicionado 'requireLogin' para proteger a rota
app.put('/api/products/reorder', requireLogin, async (req, res) => {
    try {
      const { order } = req.body;
      if (!order || !Array.isArray(order)) {
        return res.status(400).json({ error: 'Array de ordem é obrigatório.' });
      }
      for (let i = 0; i < order.length; i++) {
        await Product.update({ orderIndex: i }, { where: { id: order[i] } });
      }
      res.json({ message: 'Ordem atualizada com sucesso.' });
    } catch (error)      {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar a ordem dos produtos.' });
    }
});

// MODIFICADO: Adicionado 'requireLogin' para proteger a rota
app.delete('/api/products/:id', requireLogin, async (req, res) => {
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
      const { nome, telefone, mes, ano } = req.query;
      let where = {};
  
      if (nome) {
        where.nome = { [Op.like]: `%${nome}%` };
      }
      if (telefone) {
        where.telefone = telefone;
      }
      if (mes && ano) {
        const startDate = new Date(ano, mes - 1, 1);
        const endDate = new Date(ano, mes, 0, 23, 59, 59);
        where.dataTransacao = { [Op.between]: [startDate, endDate] };
      }
  
      const history = await PurchaseHistory.findAll({ where, order: [['dataTransacao', 'DESC']] });
      res.json(history);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar histórico.' });
    }
});


// Em server.js, na seção "ENDPOINTS DE ADMINISTRAÇÃO (Protegidos)"

// NOVO: Rota para registrar um novo dispositivo para receber notificações
app.post('/api/devices', requireLogin, async (req, res) => {
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
      console.log('Novo dispositivo registrado para notificações:', device.token);
      res.status(201).json({ message: 'Dispositivo registrado com sucesso.' });
    } else {
      res.status(200).json({ message: 'Dispositivo já estava registrado.' });
    }
  } catch (error) {
    console.error('Erro ao registrar dispositivo:', error);
    res.status(500).json({ error: 'Erro interno ao salvar o token.' });
  }
});

// REMOVIDO: Rota de debug removida por questões de segurança
// Esta rota expunha informações sensíveis e foi removida

const PORT = process.env.PORT || 3000;

// CORREÇÃO: Função de inicialização assíncrona
// Obtém token OndaPay ANTES de iniciar o servidor
async function startServer() {
  try {
    console.log('🚀 Inicializando servidor...');

    // Obtém token OndaPay antes de aceitar requisições
    console.log('📡 Obtendo token OndaPay...');
    await getOndaPayToken();
    console.log('✅ Token OndaPay obtido com sucesso');

    // Agora sim inicia o servidor
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