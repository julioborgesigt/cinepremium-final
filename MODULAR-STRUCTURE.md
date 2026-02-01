# Estrutura Modular - CinePremium

## Visão Geral

Este documento descreve a nova estrutura modular implementada para organizar o código de gateways de pagamento.

## Problema Anterior

O código original (`server.js` com 3240 linhas) tinha os seguintes problemas:

1. **Código monolítico**: Toda a lógica em um único arquivo
2. **Duplicação**: Padrões repetidos entre gateways (webhooks, validações, logging)
3. **Difícil manutenção**: Adicionar novo gateway exigia modificar múltiplas partes
4. **Tamanho do projeto**: 1.2GB principalmente devido a `node_modules` (Puppeteer)

## Nova Estrutura

```
src/
├── index.js                 # Ponto de entrada - exporta todos os módulos
│
├── config/
│   └── gateway.js           # Configurações centralizadas de gateways
│
├── gateways/
│   ├── index.js             # Factory/Registry de gateways
│   ├── base.js              # Classe base (interface) para gateways
│   ├── ondapay.js           # Implementação OndaPay
│   ├── abacatepay.js        # Implementação AbacatePay
│   └── ciabra.js            # Implementação CIABRA
│
├── webhooks/
│   └── handler.js           # Handler unificado de webhooks
│
├── services/
│   ├── purchase.js          # Serviço de compras/transações
│   └── notification.js      # Serviço de notificações push
│
└── utils/
    ├── validators.js        # Validações (CPF, email, telefone)
    ├── logger.js            # Logging centralizado
    └── errors.js            # Classes de erro customizadas
```

## Como Usar

### 1. Inicialização

```javascript
const paymentModules = require('./src');

// Inicializar com dependências
paymentModules.initialize({
  models: { PurchaseHistory, PaymentSettings, AdminDevice },
  sequelize: sequelize,
  firebaseAdmin: admin,
  firebaseReady: true
});
```

### 2. Criar QR Code PIX

```javascript
const { gateways } = require('./src');

// Usa gateway ativo automaticamente
const result = await gateways.createPixQrCode({
  purchaseId: 123,
  value: 1000, // em centavos
  nome: 'Cliente',
  cpf: '12345678901',
  email: 'cliente@email.com',
  telefone: '11999999999',
  productTitle: 'Produto X'
});

console.log(result.qrCode); // Código PIX
console.log(result.qrCodeBase64); // Imagem QR Code
```

### 3. Trocar Gateway Ativo

```javascript
const { gateways } = require('./src');

// Alterar gateway
await gateways.setActiveGateway('ciabra');

// Verificar gateway ativo
const active = await gateways.getActiveGateway();
```

### 4. Testar Conexão

```javascript
const { gateways } = require('./src');

const result = await gateways.testGatewayConnection('ondapay');
if (result.success) {
  console.log('Conexão OK');
}
```

### 5. Usar Webhooks

```javascript
const { webhooks } = require('./src');

// Usar handlers pré-configurados
app.post('/ondapay-webhook', webhookLimiter, webhooks.ondapayWebhookHandler);
app.post('/abacatepay-webhook', webhookLimiter, webhooks.abacatepayWebhookHandler);
app.post('/ciabra-webhook', webhookLimiter, webhooks.ciabraWebhookHandler);
```

### 6. Validações

```javascript
const { validators } = require('./src');

if (!validators.isValidCPF(cpf)) {
  return res.status(400).json({ error: 'CPF inválido' });
}

const sanitized = validators.sanitizeInput(userInput);
const { valid, errors } = validators.validatePaymentData(data);
```

## Gateways Suportados

| Gateway | Status | Autenticação |
|---------|--------|--------------|
| OndaPay | ✅ | Bearer Token (OAuth) |
| AbacatePay | ✅ | API Key (Bearer) |
| CIABRA | ✅ | Basic Auth |

## Adicionando Novo Gateway

1. Criar arquivo em `src/gateways/novo-gateway.js`
2. Estender `BaseGateway` e implementar métodos:
   - `isConfigured()`
   - `createPixQrCode(payload)`
   - `testConnection()`
   - `processWebhook(body)`
3. Adicionar configuração em `src/config/gateway.js`
4. Registrar no factory em `src/gateways/index.js`

```javascript
// src/gateways/novo-gateway.js
const BaseGateway = require('./base');

class NovoGateway extends BaseGateway {
  constructor() {
    const config = getGatewayConfig('novogateway');
    super('NovoGateway', config);
  }

  isConfigured() {
    return !!this.config.credentials.apiKey;
  }

  async createPixQrCode(payload) {
    // Implementação específica
  }

  async testConnection() {
    // Implementação específica
  }

  async processWebhook(body) {
    // Implementação específica
  }
}
```

## Benefícios da Refatoração

1. **Separação de responsabilidades**: Cada módulo tem função específica
2. **Reutilização**: Código comum compartilhado entre gateways
3. **Testabilidade**: Módulos podem ser testados isoladamente
4. **Extensibilidade**: Fácil adicionar novos gateways
5. **Manutenibilidade**: Mudanças em um gateway não afetam outros

## Otimização de Tamanho

### Causas do tamanho de 1.2GB

1. **node_modules/**: ~1GB (principalmente Puppeteer)
2. **Puppeteer**: ~300MB (inclui Chromium)
3. **Documentação**: 26 arquivos .md

### Soluções Implementadas

1. ✅ Documentação antiga movida para `docs/archive/`
2. ✅ `.gitignore` atualizado para ignorar arquivos temporários
3. 📋 Considerar `puppeteer-core` se Chromium já estiver instalado no servidor

### Para Reduzir node_modules

```bash
# Usar puppeteer-core (requer Chromium instalado separadamente)
npm uninstall puppeteer
npm install puppeteer-core

# Verificar tamanho
du -sh node_modules/
```
