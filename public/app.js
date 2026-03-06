'use strict';

let selectedProduct = null;
let transactionId = null;
let pollingInterval = null;
let pollingTimeout = null;
let qrCodeExpirationTimestamp = null;
let currentGateway = null;
let currentInstallmentId = null;

// CSRF Token cache
let csrfToken = null;

async function getCsrfToken() {
  if (!csrfToken) {
    try {
      const response = await fetch('/api/csrf-token');
      if (!response.ok) throw new Error('Erro ao obter CSRF token');
      const data = await response.json();
      csrfToken = data.csrfToken;
    } catch (error) {
      console.error('Erro ao obter CSRF token:', error);
      throw error;
    }
  }
  return csrfToken;
}

function isValidCPF(cpf) {
  if (typeof cpf !== 'string') return false;
  cpf = cpf.replace(/[^\d]+/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0, remainder;
  for (let i = 1; i <= 9; i++) sum += parseInt(cpf.substring(i - 1, i)) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cpf.substring(9, 10))) return false;
  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(cpf.substring(i - 1, i)) * (12 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cpf.substring(10, 11))) return false;
  return true;
}

function isValidEmail(email) {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
}

function validateCheckoutFields() {
  const nome = document.getElementById('nome').value.trim();
  const telefoneDigits = document.getElementById('telefone').value.replace(/\D/g, '');
  const cpf = document.getElementById('cpf').value;
  const email = document.getElementById('email').value.trim();
  document.getElementById('generateBtn').disabled = !(nome && telefoneDigits.length === 11 && isValidCPF(cpf) && isValidEmail(email));
}

let cachedProducts = null;

async function loadProducts() {
  try {
    const response = await fetch('/api/products');
    cachedProducts = await response.json();
    const grid = document.getElementById('productGrid');
    grid.innerHTML = '';
    cachedProducts.forEach(product => {
      const card = document.createElement('div');
      card.className = 'product-card';
      const img = document.createElement('img');
      img.src = product.image;
      img.alt = product.title;
      img.onerror = function() { this.src = '/cinepremiumredondo.png'; };
      const title = document.createElement('h3');
      title.textContent = product.title;
      const price = document.createElement('p');
      price.textContent = `R$ ${(product.price / 100).toFixed(2)}`;
      const button = document.createElement('button');
      button.className = 'button';
      button.textContent = 'Comprar';
      button.addEventListener('click', () => selectProduct(product.id));
      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(price);
      card.appendChild(button);
      grid.appendChild(card);
    });
  } catch (error) {
    console.error('Erro ao carregar produtos:', error);
    showErrorToast('Erro ao carregar produtos. Tente novamente.');
  }
}

function selectProduct(productId) {
  try {
    if (!cachedProducts) { showErrorToast('Erro ao carregar produtos. Recarregue a página.'); return; }
    selectedProduct = cachedProducts.find(p => p.id == productId);
    if (!selectedProduct) { showErrorToast('Produto não encontrado'); return; }
    const productInfo = document.getElementById('productInfo');
    productInfo.textContent = `${selectedProduct.title} - ${selectedProduct.description || ''} por R$ ${(selectedProduct.price / 100).toFixed(2)}`;
    document.getElementById('productGrid').style.display = 'none';
    document.getElementById('purchaseContainer').style.display = 'block';
    document.getElementById('qrDisplay').style.display = 'none';
    transactionId = null;
    qrCodeExpirationTimestamp = null;
    if (pollingInterval) clearInterval(pollingInterval);
    ['nome', 'telefone', 'cpf', 'email'].forEach(id => {
      document.getElementById(id).value = '';
      document.getElementById(id).classList.remove('input-valid', 'input-invalid');
    });
    validateCheckoutFields();
  } catch (error) {
    console.error('Erro ao selecionar produto:', error);
    showErrorToast('Erro ao selecionar produto');
  }
}

document.getElementById('backBtn').addEventListener('click', function() {
  document.getElementById('purchaseContainer').style.display = 'none';
  document.getElementById('productGrid').style.display = 'flex';
  qrCodeExpirationTimestamp = null;
  if (pollingInterval) clearInterval(pollingInterval);
});

async function checkPaymentStatus() {
  if (qrCodeExpirationTimestamp && Date.now() > qrCodeExpirationTimestamp) {
    document.getElementById('paymentStatus').textContent = 'Seu QR Code expirou. Por favor, volte e gere um novo.';
    clearInterval(pollingInterval);
    return;
  }
  if (!transactionId) return;
  try {
    const token = await getCsrfToken();
    const useCiabraPolling = currentGateway === 'ciabra' && currentInstallmentId;
    const endpoint = useCiabraPolling ? '/api/check-ciabra-payment' : '/check-local-status';
    const requestBody = useCiabraPolling
      ? { transactionId: transactionId, installmentId: currentInstallmentId }
      : { id: transactionId };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': token },
      body: JSON.stringify(requestBody)
    });
    if (response.status === 403) {
      csrfToken = null;
      const newToken = await getCsrfToken();
      const retryResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CSRF-Token': newToken },
        body: JSON.stringify(requestBody)
      });
      if (!retryResponse.ok) throw new Error('Erro ao verificar status');
      processPaymentStatus(await retryResponse.json());
    } else if (!response.ok) {
      throw new Error('Erro ao verificar status');
    } else {
      processPaymentStatus(await response.json());
    }
  } catch (error) {
    console.error('[POLLING] Erro ao verificar status:', error);
  }
}

function processPaymentStatus(data) {
  if (data.status && data.status.toLowerCase() === 'sucesso') {
    if (pollingInterval) clearInterval(pollingInterval);
    const mainContainer = document.getElementById('mainContainer');
    mainContainer.innerHTML = '';
    const thankYouContainer = document.createElement('div');
    thankYouContainer.className = 'thank-you-container';
    const thankYouCard = document.createElement('div');
    thankYouCard.className = 'thank-you-card';
    const title = document.createElement('h1');
    title.textContent = 'Obrigado pela sua compra!';
    const confirmText = document.createElement('p');
    confirmText.textContent = 'Sua transação foi confirmada.';
    const transactionText = document.createElement('p');
    transactionText.textContent = 'ID da Transação: ';
    const transactionSpan = document.createElement('span');
    transactionSpan.className = 'transaction-id';
    transactionSpan.textContent = transactionId;
    transactionText.appendChild(transactionSpan);
    const backButton = document.createElement('button');
    backButton.className = 'button';
    backButton.textContent = 'Voltar à Página Inicial';
    backButton.addEventListener('click', () => { window.location.href = '/'; });
    thankYouCard.appendChild(title);
    thankYouCard.appendChild(confirmText);
    thankYouCard.appendChild(transactionText);
    thankYouCard.appendChild(backButton);
    thankYouContainer.appendChild(thankYouCard);
    mainContainer.appendChild(thankYouContainer);
    clearInterval(pollingInterval);
    if (pollingTimeout) clearTimeout(pollingTimeout);
  } else {
    document.getElementById('paymentStatus').textContent = 'Aguardando confirmação do pagamento...';
  }
}

document.getElementById('generateBtn').addEventListener('click', async function() {
  if (!selectedProduct) return;
  const nome = document.getElementById('nome').value.trim();
  const telefone = document.getElementById('telefone').value.trim();
  const cpf = document.getElementById('cpf').value.trim();
  const email = document.getElementById('email').value.trim();
  document.getElementById('loadingSpinner').style.display = 'block';
  this.disabled = true;
  this.classList.add('loading');
  try {
    const token = await getCsrfToken();
    const payload = {
      value: selectedProduct.price,
      nome, telefone, cpf, email,
      productTitle: selectedProduct.title,
      productDescription: selectedProduct.description || ''
    };
    let response = await fetch('/gerarqrcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CSRF-Token': token },
      body: JSON.stringify(payload)
    });
    if (response.status === 403) {
      csrfToken = null;
      const newToken = await getCsrfToken();
      response = await fetch('/gerarqrcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CSRF-Token': newToken },
        body: JSON.stringify(payload)
      });
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => response.text());
      throw new Error(errorData.error || 'Ocorreu um erro desconhecido.');
    }
    processQRCodeResponse(await response.json());
  } catch (error) {
    console.error('Erro ao gerar QR Code:', error);
    showErrorToast(error.message);
  } finally {
    document.getElementById('loadingSpinner').style.display = 'none';
    this.disabled = false;
    this.classList.remove('loading');
  }
});

function processQRCodeResponse(data) {
  document.getElementById('qrDisplay').style.display = 'block';
  ['nome', 'telefone', 'cpf', 'email', 'generateBtn'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  const qrCodeImgContainer = document.getElementById('qrCodeImg');
  qrCodeImgContainer.innerHTML = '';
  if (data.qr_code_base64 && typeof data.qr_code_base64 === 'string') {
    const qrImg = document.createElement('img');
    qrImg.alt = 'QR Code de Pagamento';
    qrImg.style.cssText = 'width:200px;height:200px;display:block;margin:0 auto;';
    qrImg.src = 'data:image/png;base64,' + data.qr_code_base64;
    qrCodeImgContainer.appendChild(qrImg);
  } else {
    qrCodeImgContainer.innerHTML = '<p style="color:#ff9800;">QR Code não disponível</p>';
  }
  document.getElementById('qrCodeText').textContent = data.qr_code || 'Código PIX não disponível';
  transactionId = data.id;
  qrCodeExpirationTimestamp = data.expirationTimestamp;
  currentGateway = data.gateway;
  currentInstallmentId = data.installmentId || null;
  document.getElementById('transactionId').textContent = 'ID da Transação: ' + transactionId;
  if (pollingInterval) clearInterval(pollingInterval);
  if (pollingTimeout) clearTimeout(pollingTimeout);
  pollingInterval = setInterval(checkPaymentStatus, 5000);
  pollingTimeout = setTimeout(() => {
    clearInterval(pollingInterval);
    const status = document.getElementById('paymentStatus');
    status.textContent = 'Tempo limite de verificação excedido. Recarregue a página e gere um novo QR Code se necessário.';
    status.style.color = '#ff9800';
  }, 10 * 60 * 1000);
}

document.getElementById('copyBtn').addEventListener('click', function() {
  const qrCodeText = document.getElementById('qrCodeText').textContent;
  navigator.clipboard.writeText(qrCodeText)
    .then(() => showSuccessToast('Código copiado para a área de transferência!'))
    .catch(err => { console.error('Erro ao copiar:', err); showErrorToast('Erro ao copiar código'); });
});

document.getElementById('telefone').addEventListener('input', function(e) {
  let value = e.target.value.replace(/\D/g, '').substring(0, 11);
  if (value.length > 6) value = value.replace(/^(\d{2})(\d{5})(\d{0,4}).*/, '($1) $2-$3');
  else if (value.length > 2) value = value.replace(/^(\d{2})(\d{0,5}).*/, '($1) $2');
  else if (value.length > 0) value = value.replace(/^(\d*)/, '($1');
  e.target.value = value;
  validateCheckoutFields();
});

document.getElementById('cpf').addEventListener('input', function(e) {
  let value = e.target.value.replace(/\D/g, '').substring(0, 11);
  if (value.length > 9) value = value.slice(0, 9) + '-' + value.slice(9);
  if (value.length > 6) value = value.slice(0, 3) + '.' + value.slice(3, 7) + '.' + value.slice(7);
  else if (value.length > 3) value = value.slice(0, 3) + '.' + value.slice(3);
  e.target.value = value;
  const cpfDigits = value.replace(/\D/g, '');
  if (cpfDigits.length === 11) {
    e.target.classList.toggle('input-valid', isValidCPF(cpfDigits));
    e.target.classList.toggle('input-invalid', !isValidCPF(cpfDigits));
  } else {
    e.target.classList.remove('input-valid', 'input-invalid');
  }
  validateCheckoutFields();
});

document.getElementById('nome').addEventListener('input', validateCheckoutFields);
document.getElementById('email').addEventListener('input', validateCheckoutFields);

function showErrorToast(message) {
  showToast(message, '#ff5252');
}

function showSuccessToast(message) {
  showToast(message, '#4CAF50');
}

function showToast(message, color) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.background = color;
  toast.textContent = message;
  document.body.appendChild(toast);
  void toast.offsetWidth;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => document.body.removeChild(toast), 500);
  }, 4000);
}

// Inicializa: carrega produtos e pré-aquece CSRF token em paralelo
window.addEventListener('load', () => {
  Promise.all([
    loadProducts(),
    getCsrfToken()
  ]).catch(err => console.error('Erro na inicialização:', err));
});
