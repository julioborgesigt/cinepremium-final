# 🎬 CinePremium - Sistema de E-Commerce

Sistema completo de e-commerce para venda de produtos digitais com pagamento via PIX, desenvolvido para o mercado brasileiro.

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.21-blue.svg)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8+-orange.svg)](https://www.mysql.com/)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

---

## 📋 Índice

- [Características](#-características)
- [Tecnologias](#-tecnologias)
- [Requisitos](#-requisitos)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Uso](#-uso)
- [API](#-api)
- [Segurança](#-segurança)
- [Deploy](#-deploy)
- [Contribuindo](#-contribuindo)
- [Licença](#-licença)

---

## ✨ Características

### Para Clientes
- 🛒 Catálogo de produtos com imagens
- 💳 Pagamento via PIX (integração OndaPay)
- 📱 QR Code dinâmico com expiração
- ✅ Validação de CPF, e-mail e telefone
- ⏱️ Verificação automática de status de pagamento
- 📝 Página de confirmação de compra

### Para Administradores
- 🔐 Login seguro com sessões
- ➕ Adicionar/editar/remover produtos
- 🔄 Reordenação de produtos (drag-and-drop)
- 📊 Histórico de compras com filtros
- 🔔 Notificações push (Firebase)
- 📱 PWA com suporte offline

### Segurança
- 🛡️ Helmet.js (headers de segurança)
- 🚦 Rate limiting (proteção DDoS/brute force)
- 🔒 Cookies httpOnly, secure e sameSite
- ✅ Validações completas no backend
- 🌐 CORS configurável por ambiente

---

## 🛠️ Tecnologias

### Backend
- **Node.js** 18+ (Runtime)
- **Express.js** 4.21 (Framework web)
- **Sequelize** 6.37 (ORM)
- **MySQL2** 3.15 (Driver de banco de dados)
- **Firebase Admin SDK** 13.6 (Push notifications)

### Frontend
- **Vanilla JavaScript** (ES6+)
- **HTML5** / **CSS3**
- **Firebase Cloud Messaging** (Notificações)
- **Sortable.js** 1.15 (Drag-and-drop)

### Segurança
- **Helmet.js** 8.1 (HTTP headers)
- **express-rate-limit** 8.2 (Rate limiting)
- **CORS** 2.8 (Cross-Origin Resource Sharing)
- **express-session** 1.18 (Gerenciamento de sessões)

### Pagamentos
- **OndaPay API** (Gateway de pagamento PIX)
- **Axios** 1.13 (Cliente HTTP)

---

## 📦 Requisitos

- Node.js 18.x ou superior
- MySQL 8.0 ou superior
- Conta OndaPay (para pagamentos PIX)
- Projeto Firebase (para notificações push)
- Domínio com HTTPS (produção)

---

## 🚀 Instalação

### 1. Clone o Repositório

```bash
git clone https://github.com/julioborgesigt/cinepremium-final.git
cd cinepremium-final
```

### 2. Instale as Dependências

```bash
npm install
```

### 3. Configure o Banco de Dados

```sql
CREATE DATABASE cinepremiumedit_banco CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. Configure as Variáveis de Ambiente

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais reais. Consulte a [seção de Configuração](#-configuração) para detalhes.

### 5. Inicie o Servidor

```bash
# Desenvolvimento
npm start

# Ou com nodemon (reinicialização automática)
npm install -g nodemon
nodemon server.js
```

O servidor estará rodando em `http://localhost:3000`

---

## ⚙️ Configuração

### Variáveis de Ambiente Essenciais

Copie `.env.example` para `.env` e configure:

```bash
# Ambiente
NODE_ENV=development  # ou 'production'
PORT=3000

# Segurança
SESSION_SECRET=<gerar-string-aleatória-forte>

# Autenticação
ADMIN_USER=admin
ADMIN_PASS=<sua-senha-forte>

# Banco de Dados
DB_NAME=cinepremiumedit_banco
DB_USER=seu_usuario
DB_PASS=sua_senha
DB_HOST=localhost

# OndaPay
ONDAPAY_CLIENT_ID=seu_client_id
ONDAPAY_CLIENT_SECRET=seu_client_secret
WEBHOOK_URL=https://seu-dominio.com/ondapay-webhook
ONDAPAY_WEBHOOK_SECRET=seu_webhook_secret  # IMPORTANTE!

# Firebase
FIREBASE_CREDENTIALS_BASE64=<credentials-em-base64>
FIREBASE_API_KEY=sua_api_key
FIREBASE_PROJECT_ID=seu_projeto_id
# ... demais configurações Firebase

# CORS (produção)
ALLOWED_ORIGINS=https://seu-dominio.com,https://www.seu-dominio.com
```

### Gerar SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Configurar Firebase

1. Acesse o [Firebase Console](https://console.firebase.google.com/)
2. Crie um novo projeto ou use um existente
3. Ative Cloud Messaging
4. Baixe as credenciais de service account (JSON)
5. Converta para Base64:

```bash
node -e "console.log(Buffer.from(require('fs').readFileSync('firebase-credentials.json')).toString('base64'))"
```

6. Cole o resultado em `FIREBASE_CREDENTIALS_BASE64`

### Configurar OndaPay

1. Crie uma conta em [OndaPay](https://ondapay.app/)
2. Obtenha suas credenciais de API
3. Configure o webhook URL (seu domínio + `/ondapay-webhook`)

---

## 💻 Uso

### Interface do Cliente

Acesse: `http://localhost:3000/`

1. Navegue pelo catálogo de produtos
2. Clique em "Comprar"
3. Preencha seus dados (nome, telefone, CPF, e-mail)
4. Gere o QR Code PIX
5. Pague via seu app bancário
6. Aguarde confirmação automática

### Painel Administrativo

Acesse: `http://localhost:3000/login`

Credenciais: Configure em `ADMIN_USER` e `ADMIN_PASS`

**Funcionalidades:**
- Adicionar novos produtos (título, preço, imagem, descrição)
- Reordenar produtos (arrastar e soltar)
- Excluir produtos
- Visualizar histórico de compras
- Filtrar por nome, telefone ou data
- Receber notificações push de vendas

---

## 📡 API

### Endpoints Públicos

#### `GET /api/products`
Lista todos os produtos ordenados.

**Resposta:**
```json
[
  {
    "id": 1,
    "title": "Produto Exemplo",
    "price": 1999,
    "image": "data:image/png;base64,...",
    "description": "Descrição do produto",
    "orderIndex": 0
  }
]
```

#### `POST /gerarqrcode`
Gera QR Code PIX para pagamento.

**Body:**
```json
{
  "value": 1999,
  "nome": "João Silva",
  "telefone": "(11) 98765-4321",
  "cpf": "123.456.789-00",
  "email": "joao@example.com",
  "productTitle": "Produto Exemplo",
  "productDescription": "Descrição"
}
```

**Resposta:**
```json
{
  "id": "transaction_id_123",
  "qr_code": "00020126580014br.gov.bcb.pix...",
  "qr_code_base64": "data:image/png;base64,...",
  "expirationTimestamp": 1704567890000
}
```

#### `POST /check-local-status`
Verifica status do pagamento.

**Body:**
```json
{
  "id": "transaction_id_123"
}
```

**Resposta:**
```json
{
  "id": "transaction_id_123",
  "status": "Sucesso"
}
```

### Endpoints Protegidos (Requerem Login)

#### `POST /api/products`
Cria novo produto.

#### `PUT /api/products/reorder`
Reordena produtos.

#### `DELETE /api/products/:id`
Remove produto.

#### `GET /api/purchase-history`
Busca histórico de compras.

---

## 🔒 Segurança

Consulte [SECURITY.md](./SECURITY.md) para detalhes completos sobre:
- Medidas de segurança implementadas
- Vulnerabilidades conhecidas
- Melhores práticas
- Checklist de deploy

### Proteções Implementadas

- ✅ Helmet.js (headers de segurança HTTP)
- ✅ Rate limiting global (100 req/15min)
- ✅ Rate limiting de login (5 tentativas/15min)
- ✅ Cookies seguros (httpOnly, secure, sameSite)
- ✅ CORS configurável
- ✅ Validações completas no backend
- ✅ Proteção contra XSS e CSRF

### ⚠️ Pendências Críticas

- ❌ **Verificação de assinatura no webhook** (CRÍTICO)
- ⚠️ **Firebase config ainda no frontend** (MÉDIA)
- ⚠️ **Senha sem hash** (MÉDIA)

---

## 🚢 Deploy

### Preparação

1. Configure `NODE_ENV=production`
2. Configure `ALLOWED_ORIGINS` com seus domínios
3. Certifique-se de que HTTPS está habilitado
4. Configure certificado SSL válido
5. Implemente verificação de assinatura do webhook ⚠️

### Deploy Recomendado

**Plataformas suportadas:**
- ✅ DomCloud (atual)
- ✅ Heroku
- ✅ DigitalOcean
- ✅ AWS EC2
- ✅ Google Cloud Platform
- ✅ Azure App Service

### Exemplo: Deploy na Heroku

```bash
# Login
heroku login

# Criar app
heroku create cinepremium-app

# Adicionar MySQL
heroku addons:create jawsdb:kitefin

# Configurar variáveis de ambiente
heroku config:set NODE_ENV=production
heroku config:set SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# ... demais variáveis

# Deploy
git push heroku main

# Abrir app
heroku open
```

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor, siga estas diretrizes:

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

### Diretrizes de Código

- Siga o estilo de código existente
- Adicione comentários para código complexo
- Valide todas as entradas no backend
- Escreva mensagens de commit descritivas
- Teste suas mudanças localmente

---

## 📄 Licença

Este projeto está licenciado sob a Licença ISC.

---

## 📞 Suporte

- **Email**: cinepremium.sac@gmail.com
- **Issues**: [GitHub Issues](https://github.com/julioborgesigt/cinepremium-final/issues)

---

## 🙏 Agradecimentos

- [Express.js](https://expressjs.com/) - Framework web
- [Sequelize](https://sequelize.org/) - ORM
- [OndaPay](https://ondapay.app/) - Gateway de pagamento
- [Firebase](https://firebase.google.com/) - Push notifications
- [Helmet.js](https://helmetjs.github.io/) - Segurança HTTP

---

## 📈 Status do Projeto

🟢 **Ativo** - Em desenvolvimento e manutenção contínua

### Próximas Features

- [ ] Verificação de assinatura no webhook
- [ ] Hash de senhas com bcrypt
- [ ] Testes automatizados
- [ ] Migrations do Sequelize
- [ ] Dashboard de analytics
- [ ] Exportação de relatórios (PDF/Excel)
- [ ] Integração com outros gateways de pagamento

---

**Desenvolvido com ❤️ para o mercado brasileiro**

---

## 📚 Documentação Adicional

- [Guia de Segurança](./SECURITY.md)
- [Variáveis de Ambiente](./.env.example)
- [Changelog](./CHANGELOG.md) *(em breve)*
- [API Documentation](./docs/API.md) *(em breve)*

---

**Última atualização**: 06/01/2025
**Versão**: 2.0.0
