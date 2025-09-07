// NOVO: Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const admin = require('firebase-admin');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios'); // Utilize axios para requisições HTTP
const { Op } = require('sequelize');
const { Product, PurchaseHistory, AdminDevice } = require('./models');

// NOVO: Dependências para gerenciar sessões e cookies
const session = require('express-session');
const cookieParser = require('cookie-parser');

const app = express();
app.use(bodyParser.json());
// NOVO: Adicionado para interpretar dados de formulários HTML (para o login)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// NOVO: Configuração do middleware de sessão
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET, // Chave secreta para assinar o cookie da sessão
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // A sessão expira em 8 horas
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

// NOVO: Função reutilizável para enviar notificações
// Em server.js, substitua a função sendPushNotification inteira por esta:

// MODIFICADO: Função reutilizável para enviar notificações com logs detalhados
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

// NOVO: Rota para validar as credenciais enviadas pelo formulário de login
app.post('/auth', (req, res) => {
  const { username, password } = req.body;
  // Compara os dados do formulário com as variáveis de ambiente seguras
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.loggedin = true; // Se as credenciais estiverem corretas, cria a sessão
    res.redirect('/admin'); // Redireciona para o painel de admin
  } else {
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

// Endpoint para gerar QR Code de pagamento
// MODIFICADO: A rota de gerar QR Code agora tem a lógica de renovação de token
app.post('/gerarqrcode', async (req, res) => {
  try {
    const { value, nome, telefone, cpf, email, productTitle, productDescription } = req.body;
    if (!value || !nome || !telefone || !cpf || !email) {
      return res.status(400).json({ error: "Todos os campos, incluindo e-mail, são obrigatórios." });
    }
    
    // ... (lógica de verificação de tentativas de compra inalterada) ...
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const attemptsLastHour = await PurchaseHistory.count({ where: { telefone, dataTransacao: { [Op.gte]: oneHourAgo } } });
    const attemptsLastMonth = await PurchaseHistory.count({ where: { telefone, dataTransacao: { [Op.gte]: oneMonthAgo } } });
    if (attemptsLastHour >= 3 || attemptsLastMonth >= 5) {
      return res.status(429).json({ error: 'Você já tentei pagar muitas vezes, procure seu vendedor ou tente novamente depois de algumas horas' });
    }
    
    const purchaseRecord = await PurchaseHistory.create({ nome, telefone, status: 'Gerado' });
    const expirationDate = new Date();
    expirationDate.setMinutes(expirationDate.getMinutes() + 30);
    const pad = (num) => String(num).padStart(2, '0');
    const dueDateFormatted = `${expirationDate.getFullYear()}-${pad(expirationDate.getMonth() + 1)}-${pad(expirationDate.getDate())} ${pad(expirationDate.getHours())}:${pad(expirationDate.getMinutes())}:${pad(expirationDate.getSeconds())}`;

    // NOVO: Envia notificação de nova venda
    sendPushNotification(
      'Nova Tentativa de Venda!',
      `${nome} gerou um QR Code para pagamento.`
    );


    const payload = {
      amount: parseFloat((value / 100).toFixed(2)),
      external_id: purchaseRecord.id.toString(),
      webhook: WEBHOOK_URL,
      description: `${productTitle} - ${productDescription || ''}`,
      dueDate: dueDateFormatted,
      payer: { name: nome, document: cpf.replace(/\D/g, ''), email: email }
    };
    
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

// Webhook para receber confirmação de pagamento
app.post('/ondapay-webhook', async (req, res) => {
    console.log('--- [WEBHOOK LOG] --- Webhook Recebido. Corpo da requisição:');
    console.log(JSON.stringify(req.body, null, 2));
    console.log('--- [WEBHOOK LOG] --- Fim do corpo da requisição.');

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

// MODIFICADO: Adicionado 'requireLogin' para proteger a rota
app.post('/api/products', requireLogin, async (req, res) => {
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

// NOVO: Rota temporária para depurar as variáveis de ambiente
// Rota temporária para depurar as variáveis de ambiente
app.get('/debug-env', (req, res) => {
  const firebaseCreds = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  res.json({
    message: "Verificação das variáveis de ambiente no servidor:",
    FIREBASE_SERVICE_ACCOUNT_JSON_EXISTS: !!firebaseCreds,
    FIREBASE_SERVICE_ACCOUNT_JSON_IS_STRING: typeof firebaseCreds === 'string',
    FIREBASE_SERVICE_ACCOUNT_JSON_LENGTH: firebaseCreds ? firebaseCreds.length : 0,
    FIREBASE_SERVICE_ACCOUNT_JSON_START: firebaseCreds ? firebaseCreds.substring(0, 50) + '...' : null
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  await getOndaPayToken();
});