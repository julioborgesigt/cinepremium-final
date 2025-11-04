// NOVO: Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const admin = require('firebase-admin');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { Op } = require('sequelize');
const { Product, PurchaseHistory, AdminDevice } = require('./models');

// Dependências de segurança
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');

// Dependências para gerenciar sessões e cookies
const session = require('express-session');
const cookieParser = require('cookie-parser');

const app = express();

// SEGURANÇA: Forçar HTTPS em produção
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// SEGURANÇA: Headers de segurança HTTP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.gstatic.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.ondapay.app", "https://fcm.googleapis.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Parsers nativos do Express (body-parser não é mais necessário)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do middleware de sessão com flags de segurança
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false, // Alterado para false por segurança
  name: 'sessionId', // Nome customizado em vez de 'connect.sid'
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 horas
    httpOnly: true, // Previne acesso via JavaScript
    secure: process.env.NODE_ENV === 'production', // Apenas HTTPS em produção
    sameSite: 'strict' // Proteção contra CSRF
  }
}));


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
  console.log('Firebase Admin SDK inicializado com sucesso via Base64.');

} catch (error) {
  console.error('Erro CRÍTICO ao inicializar o Firebase Admin SDK:', error.message);
  console.log('As notificações push não funcionarão.');
}

// SEGURANÇA: Rate limiters para diferentes endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 tentativas por IP
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

const qrCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // 10 QR codes por IP por hora
  message: { error: 'Muitas tentativas de geração de QR Code. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requisições por IP
  standardHeaders: true,
  legacyHeaders: false
});

// SEGURANÇA: Função para sanitizar dados sensíveis dos logs
function sanitizeForLog(data) {
  if (!data) return data;

  const sanitized = { ...data };
  const sensitiveFields = ['cpf', 'telefone', 'nome', 'email', 'password', 'document'];

  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      const value = String(sanitized[field]);
      if (value.length > 4) {
        sanitized[field] = value.substring(0, 2) + '***' + value.substring(value.length - 2);
      } else {
        sanitized[field] = '***';
      }
    }
  });

  if (sanitized.payer) {
    sanitized.payer = sanitizeForLog(sanitized.payer);
  }

  return sanitized;
}

// SEGURANÇA: Schemas de validação com Joi
const qrCodeSchema = Joi.object({
  value: Joi.number().integer().positive().required(),
  nome: Joi.string().min(3).max(100).pattern(/^[a-zA-ZÀ-ÿ\s]+$/).required(),
  telefone: Joi.string().pattern(/^\(\d{2}\)\s\d{5}-\d{4}$/).required(),
  cpf: Joi.string().pattern(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/).required(),
  email: Joi.string().email().required(),
  productTitle: Joi.string().max(200).required(),
  productDescription: Joi.string().max(500).allow('', null)
});

const purchaseHistorySchema = Joi.object({
  nome: Joi.string().min(3).max(100).pattern(/^[a-zA-ZÀ-ÿ\s]+$/).optional(),
  telefone: Joi.string().pattern(/^\d{10,11}$/).optional(),
  mes: Joi.number().integer().min(1).max(12).optional(),
  ano: Joi.number().integer().min(2025).max(2100).optional()
});

// Função reutilizável para enviar notificações com logs sanitizados
async function sendPushNotification(title, body) {
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

    console.log(`[PUSH LOG] Encontrado(s) ${tokens.length} dispositivo(s). Tokens:`, tokens);

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
  if (req.session.loggedin) {
    next();
  } else {
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

// SEGURANÇA: Rota para validar credenciais com rate limiting
app.post('/auth', loginLimiter, (req, res) => {
  const { username, password } = req.body;

  // Validação de entrada
  if (!username || !password) {
    return res.redirect('/login?error=1');
  }

  // Compara os dados do formulário com as variáveis de ambiente seguras
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.loggedin = true;
    req.session.username = username; // Armazena username na sessão
    console.log(`[AUTH] Login bem-sucedido para usuário: ${username}`);
    res.redirect('/admin');
  } else {
    console.log(`[AUTH] Tentativa de login falhou para usuário: ${username}`);
    res.redirect('/login?error=1');
  }
});

// NOVO: Rota para fazer logout e destruir a sessão
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.redirect('/admin'); // Se houver erro, volta para o admin
    }
    res.clearCookie('connect.sid'); // Limpa o cookie da sessão
    res.redirect('/login');
  });
});

// --- FIM DA SEÇÃO DE AUTENTICAÇÃO ---


// MODIFICADO: A rota para a página de administração agora está protegida pelo middleware requireLogin
app.get('/admin', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- CONFIGURAÇÃO DA API DE PAGAMENTO (ONDAPAY) ---
const ONDAPAY_API_URL = "https://api.ondapay.app";
// MODIFICADO: Credenciais agora vêm de variáveis de ambiente
const ONDAPAY_CLIENT_ID = process.env.ONDAPAY_CLIENT_ID;
const ONDAPAY_CLIENT_SECRET = process.env.ONDAPAY_CLIENT_SECRET;
const WEBHOOK_URL = "https://cinepremiumedit.domcloud.dev/ondapay-webhook";

let ondaPayToken = null;

// Função para obter/renovar o token de autenticação
// MODIFICADO: A função agora aceita um parâmetro para forçar a renovação
async function getOndaPayToken(forceNew = false) {
  if (ondaPayToken && !forceNew) {
    return ondaPayToken;
  }
  try {
    const response = await axios.post(`${ONDAPAY_API_URL}/api/v1/login`, {}, {
      headers: {
        'client_id': ONDAPAY_CLIENT_ID,
        'client_secret': ONDAPAY_CLIENT_SECRET,
        'Content-Type': 'application/json'
      }
    });
    ondaPayToken = response.data.token;
    console.log("Token da OndaPay obtido/renovado com sucesso.");
    return ondaPayToken;
  } catch (error) {
    console.error("Erro ao obter token da OndaPay:", error.response ? error.response.data : error.message);
    ondaPayToken = null; 
    throw new Error("Não foi possível autenticar com o serviço de pagamento.");
  }
}

// --- ROTAS PÚBLICAS (Acessíveis sem login) ---

// SEGURANÇA: Endpoint para gerar QR Code com validação, rate limiting e sanitização
app.post('/gerarqrcode', qrCodeLimiter, async (req, res) => {
  try {
    // Validação de entrada com Joi
    const { error, value: validatedData } = qrCodeSchema.validate(req.body);
    if (error) {
      console.log(`[QR CODE] Validação falhou: ${error.details[0].message}`);
      return res.status(400).json({ error: error.details[0].message });
    }

    const { value, nome, telefone, cpf, email, productTitle, productDescription } = validatedData;

    // Remove formatação do telefone para verificação no banco
    const telefoneLimpo = telefone.replace(/\D/g, '');

    // Verificação de tentativas de compra (baseada em telefone limpo)
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const attemptsLastHour = await PurchaseHistory.count({
      where: { telefone: telefoneLimpo, dataTransacao: { [Op.gte]: oneHourAgo } }
    });
    const attemptsLastMonth = await PurchaseHistory.count({
      where: { telefone: telefoneLimpo, dataTransacao: { [Op.gte]: oneMonthAgo } }
    });

    if (attemptsLastHour >= 3 || attemptsLastMonth >= 5) {
      console.log(`[QR CODE] Limite de tentativas excedido para telefone: ${sanitizeForLog({ telefone: telefoneLimpo }).telefone}`);
      return res.status(429).json({ error: 'Você já tentou pagar muitas vezes. Procure seu vendedor ou tente novamente depois de algumas horas.' });
    }
    
    // Cria registro de compra com telefone limpo
    const purchaseRecord = await PurchaseHistory.create({
      nome,
      telefone: telefoneLimpo,
      status: 'Gerado'
    });

    const expirationDate = new Date();
    expirationDate.setMinutes(expirationDate.getMinutes() + 30);
    const pad = (num) => String(num).padStart(2, '0');
    const dueDateFormatted = `${expirationDate.getFullYear()}-${pad(expirationDate.getMonth() + 1)}-${pad(expirationDate.getDate())} ${pad(expirationDate.getHours())}:${pad(expirationDate.getMinutes())}:${pad(expirationDate.getSeconds())}`;

    // Envia notificação de nova venda com dados sanitizados
    const sanitizedNome = sanitizeForLog({ nome }).nome;
    sendPushNotification(
      'Nova Tentativa de Venda!',
      `Cliente gerou um QR Code para pagamento.`
    );

    const payload = {
      amount: parseFloat((value / 100).toFixed(2)),
      external_id: purchaseRecord.id.toString(),
      webhook: WEBHOOK_URL,
      description: `${productTitle} - ${productDescription || ''}`,
      dueDate: dueDateFormatted,
      payer: { name: nome, document: cpf.replace(/\D/g, ''), email: email }
    };

    console.log('[QR CODE] Payload sanitizado:', sanitizeForLog(payload));
    
    // NOVO: Lógica de tentativa e renovação do token
    let token = await getOndaPayToken();
    let response;
    
    try {
      // Primeira tentativa com o token atual
      response = await axios.post(`${ONDAPAY_API_URL}/api/v1/deposit/pix`, payload, {
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
      });
    } catch (error) {
      // Se a primeira tentativa falhar com erro 401 (Não Autorizado), o token provavelmente expirou
      if (error.response && error.response.status === 401) {
        console.log("Token da OndaPay expirado. Renovando e tentando novamente...");
        // Força a obtenção de um novo token
        token = await getOndaPayToken(true); 
        // Segunda (e última) tentativa com o novo token
        response = await axios.post(`${ONDAPAY_API_URL}/api/v1/deposit/pix`, payload, {
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
        });
      } else {
        // Se o erro for diferente de 401, propaga o erro para ser tratado abaixo
        throw error;
      }
    }

    const data = response.data;
    await purchaseRecord.update({ transactionId: data.id_transaction });
    
    const resultado = {
      id: data.id_transaction,
      qr_code: data.qrcode,
      qr_code_base64: data.qrcode_base64,
      expirationTimestamp: expirationDate.getTime()
    };

    console.log("QR Code gerado (OndaPay):", resultado.id);
    res.json(resultado);
  } catch (error) {
    let errorMessage = "Erro interno ao gerar QR code.";
    if (error.response && error.response.data && error.response.data.msg) {
        errorMessage = Object.values(error.response.data.msg)[0];
        console.error("Erro da API OndaPay:", error.response.data);
    } else {
        console.error("Erro ao gerar QR code:", error.message);
    }
    res.status(400).json({ error: errorMessage });
  }
});

// SEGURANÇA: Webhook com verificação de assinatura e sanitização
app.post('/ondapay-webhook', async (req, res) => {
    console.log('--- [WEBHOOK LOG] --- Webhook Recebido.');

    try {
      // IMPORTANTE: Verificação de assinatura do webhook
      // Nota: A implementação exata depende de como a OndaPay assina webhooks
      // Este é um exemplo usando HMAC SHA256
      const signature = req.headers['x-ondapay-signature'] || req.headers['x-signature'];

      if (signature && process.env.ONDAPAY_CLIENT_SECRET) {
        const bodyString = JSON.stringify(req.body);
        const expectedSignature = crypto
          .createHmac('sha256', process.env.ONDAPAY_CLIENT_SECRET)
          .update(bodyString)
          .digest('hex');

        if (signature !== expectedSignature) {
          console.error('[WEBHOOK LOG] Assinatura inválida! Possível tentativa de fraude.');
          return res.status(403).send('Assinatura inválida');
        }
        console.log('[WEBHOOK LOG] Assinatura verificada com sucesso.');
      } else {
        console.warn('[WEBHOOK LOG] AVISO: Webhook recebido sem assinatura. Configure verificação de assinatura!');
      }

      // Log sanitizado do corpo da requisição
      console.log('[WEBHOOK LOG] Dados sanitizados:', sanitizeForLog(req.body));

      const { status, transaction_id, external_id } = req.body;
      if (!status || !transaction_id || !external_id) {
        console.warn('[WEBHOOK LOG] Webhook recebido com dados incompletos.');
        return res.status(400).send('Dados do webhook incompletos.');
      }
  
      if (status.toUpperCase() === 'PAID_OUT') {
        console.log(`[WEBHOOK LOG] Status 'PAID_OUT' detectado para external_id: ${external_id}`);
        const purchaseId = parseInt(external_id, 10);
        if (isNaN(purchaseId)) {
          console.error(`[WEBHOOK LOG] Erro: external_id '${external_id}' não é um número válido.`);
          return res.status(400).send('external_id inválido.');
        }

        console.log(`[WEBHOOK LOG] Tentando atualizar o registro com ID: ${purchaseId} para 'Sucesso'.`);
        const [updatedRows] = await PurchaseHistory.update(
          { status: 'Sucesso' },
          { where: { id: purchaseId } }
        );

        if (updatedRows > 0) {
            console.log(`[WEBHOOK LOG] SUCESSO! ${updatedRows} registro(s) atualizado(s) para a compra ID ${purchaseId}.`);
            // Precisamos buscar o nome do cliente para a notificação
            const purchase = await PurchaseHistory.findByPk(purchaseId);
            if (purchase) {
              // NOVO: Envia notificação de pagamento confirmado
              sendPushNotification(
                'Venda Paga com Sucesso!',
                `O pagamento de ${purchase.nome} foi confirmado.`
              );
            }
        } else {
            console.warn(`[WEBHOOK LOG] AVISO: Nenhum registro encontrado ou atualizado para o ID de compra ${purchaseId}. Verifique se o external_id está correto.`);
        }
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

// SEGURANÇA: Endpoints de produtos com rate limiting
app.post('/api/products', requireLogin, apiLimiter, async (req, res) => {
    try {
      const { title, price, image, description } = req.body;
      if (!title || !price || !image) {
        return res.status(400).json({ error: 'Título, preço e imagem são obrigatórios.' });
      }
      const product = await Product.create({ title, price, image, description });
      res.json(product);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao criar produto.' });
    }
});
  
app.put('/api/products/reorder', requireLogin, apiLimiter, async (req, res) => {
    try {
      const { order } = req.body;
      if (!order || !Array.isArray(order)) {
        return res.status(400).json({ error: 'Array de ordem é obrigatório.' });
      }
      for (let i = 0; i < order.length; i++) {
        await Product.update({ orderIndex: i }, { where: { id: order[i] } });
      }
      res.json({ message: 'Ordem atualizada com sucesso.' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar a ordem dos produtos.' });
    }
});

app.delete('/api/products/:id', requireLogin, apiLimiter, async (req, res) => {
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

// SEGURANÇA: Endpoint de histórico com validação e rate limiting
app.get('/api/purchase-history', requireLogin, apiLimiter, async (req, res) => {
    try {
      // Validação de query params
      const { error, value: validatedQuery } = purchaseHistorySchema.validate(req.query);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { nome, telefone, mes, ano } = validatedQuery;
      let where = {};

      if (nome) {
        // Usar bind parameter do Sequelize para prevenir SQL injection
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

      const history = await PurchaseHistory.findAll({
        where,
        order: [['dataTransacao', 'DESC']],
        limit: 1000 // Limite de segurança
      });

      console.log(`[PURCHASE HISTORY] Consulta realizada por ${req.session.username}, retornando ${history.length} registros`);
      res.json(history);
    } catch (error) {
      console.error('[PURCHASE HISTORY] Erro:', error.message);
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

// Endpoint /debug-env REMOVIDO por segurança
// Nunca exponha informações de configuração em produção

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  await getOndaPayToken();
});