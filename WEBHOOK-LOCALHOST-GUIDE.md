# 🔧 Guia: Webhooks em Ambiente Local (Localhost)

**Data:** 16 de Novembro de 2025
**Problema:** OndaPay não envia webhooks para localhost

---

## 🔍 O PROBLEMA

Quando seu servidor está rodando em **localhost** (desenvolvimento):

❌ **O que NÃO funciona:**
```
QR Code gerado → Cliente paga → OndaPay tenta enviar webhook → FALHA
                                    ↓
                          Webhook nunca chega ao seu servidor
                                    ↓
                          Status permanece "Gerado" forever
```

**Por quê?** A API OndaPay está na nuvem e **não consegue acessar localhost** do seu computador. Ela só consegue enviar webhooks para URLs públicas com HTTPS.

---

## ✅ SOLUÇÕES

### Solução 1: Simulador de Webhook (Desenvolvimento/Testes) ⭐ RECOMENDADO

Use o endpoint `/api/simulate-webhook` que acabei de criar.

**Fluxo:**
1. Gere o QR Code normalmente
2. **NÃO pague de verdade** (ou pague se quiser testar o fluxo completo)
3. Simule o webhook manualmente

**Como usar:**

1. Após gerar o QR Code, copie o **Transaction ID** que aparece na página:
   ```
   ID da Transação: TRX-20251116183542-3033
   ```

2. Acesse o painel admin: `https://localhost:3000/admin`

3. Abra o console do navegador (F12) e execute:
   ```javascript
   // 1. Obter CSRF token
   const tokenResp = await fetch('/api/csrf-token');
   const { csrfToken } = await tokenResp.json();

   // 2. Simular webhook (substitua o transactionId)
   const resp = await fetch('/api/simulate-webhook', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'CSRF-Token': csrfToken
     },
     body: JSON.stringify({
       transactionId: 'TRX-20251116183542-3033'  // ← Seu Transaction ID aqui
     })
   });

   const result = await resp.json();
   console.log(result);
   ```

4. **Resultado esperado:**
   ```json
   {
     "success": true,
     "message": "Webhook simulado com sucesso",
     "purchase": {
       "id": 123,
       "transactionId": "TRX-20251116183542-3033",
       "status": "Sucesso",
       "nome": "João Silva"
     }
   }
   ```

5. **Verificar na página de venda:**
   - Volte para a aba onde o QR Code está sendo exibido
   - Em até 5 segundos, a página deve atualizar automaticamente
   - Você verá a mensagem "Obrigado pela sua compra!"

---

### Solução 2: Ngrok (Túnel HTTP → Localhost)

Ngrok cria uma URL pública temporária que redireciona para seu localhost.

**Instalação:**
```bash
# 1. Baixe o ngrok: https://ngrok.com/download

# 2. Execute (com servidor rodando na porta 3000):
ngrok http 3000
```

**Configuração:**
```bash
# O ngrok vai gerar uma URL como:
# https://abc123.ngrok.io → http://localhost:3000

# 1. Copie a URL HTTPS gerada
# 2. Atualize o .env:
WEBHOOK_URL=https://abc123.ngrok.io/ondapay-webhook

# 3. Reinicie o servidor
npm run dev
```

**⚠️ Limitações:**
- URL muda toda vez que você reinicia o ngrok (plano gratuito)
- Precisa atualizar WEBHOOK_URL e reiniciar servidor
- Pode ter latência adicional

---

### Solução 3: Deploy em Servidor Público (Produção) 🚀

Para produção, deploy em um serviço com URL pública:

**Opções populares:**
- **Railway** (gratuito, fácil): https://railway.app
- **Render** (gratuito, HTTPS automático): https://render.com
- **Heroku** (pago após nov/2022): https://heroku.com
- **DigitalOcean**: https://digitalocean.com
- **AWS EC2**: https://aws.amazon.com/ec2

**Configuração:**
```bash
# No .env do servidor:
WEBHOOK_URL=https://seu-app.railway.app/ondapay-webhook
NODE_ENV=production
```

**Vantagens:**
✅ Webhooks funcionam automaticamente
✅ HTTPS configurado
✅ URL permanente
✅ Pronto para clientes reais

---

## 🔍 DIAGNÓSTICO

Use o endpoint `/api/debug-payment` para diagnosticar problemas:

**Como usar:**

1. Acesse (substituindo o transactionId):
   ```
   https://localhost:3000/api/debug-payment/TRX-20251116183542-3033
   ```

2. **Resposta esperada:**
   ```json
   {
     "found": true,
     "purchase": {
       "id": 123,
       "transactionId": "TRX-20251116183542-3033",
       "nome": "João Silva",
       "status": "Gerado",
       "dataTransacao": "2025-11-16T18:35:35.000Z"
     },
     "webhookInfo": {
       "webhookUrl": "http://localhost:3000/ondapay-webhook",
       "webhookSecretConfigured": true,
       "isLocalhost": true,
       "warning": "⚠️ WEBHOOK_URL aponta para localhost. OndaPay não consegue enviar webhooks para localhost!"
     },
     "troubleshooting": {
       "statusIsGerado": true,
       "tips": [
         "1. Verifique se o pagamento foi realmente efetuado no Pix",
         "2. Se sim, verifique se o webhook está chegando (logs do servidor)",
         "3. Se servidor está em localhost, webhook NÃO vai funcionar",
         "4. Para localhost, você pode simular o webhook manualmente"
       ]
     }
   }
   ```

---

## 📝 CHECKLIST DE TROUBLESHOOTING

### Quando testar localmente:

- [ ] Gerei o QR Code com sucesso?
- [ ] Transaction ID apareceu na página?
- [ ] Copiei o Transaction ID corretamente?
- [ ] Usei `/api/simulate-webhook` para simular pagamento?
- [ ] Página atualizou para "Obrigado pela compra"?

### Quando testar com Ngrok:

- [ ] Ngrok está rodando?
- [ ] WEBHOOK_URL no .env aponta para URL do ngrok?
- [ ] Reiniciei o servidor após atualizar .env?
- [ ] Logs mostram `[WEBHOOK LOG] --- Webhook Recebido`?

### Quando testar em produção:

- [ ] Servidor está rodando em URL pública?
- [ ] WEBHOOK_URL aponta para URL pública?
- [ ] HTTPS está configurado?
- [ ] OndaPay está configurado para enviar webhooks?

---

## 🐛 LOGS ÚTEIS

**Webhook chegou:**
```
--- [WEBHOOK LOG] --- Webhook Recebido
[WEBHOOK LOG] Atualizando o registro com ID: 123 para 'Sucesso'.
[WEBHOOK LOG] SUCESSO! Compra ID 123 atualizada.
```

**Webhook NÃO chegou:**
```
✅ QR Code gerado (OndaPay): TRX-20251116183542-3033
[STATUS CHECK] Status para transactionId TRX-20251116183542-3033 é 'Gerado'.
[STATUS CHECK] Status para transactionId TRX-20251116183542-3033 é 'Gerado'.
[STATUS CHECK] Status para transactionId TRX-20251116183542-3033 é 'Gerado'.
... (polling continua, status nunca muda)
```

**Webhook simulado manualmente:**
```
[PUSH LOG] Iniciando envio de notificação: "Venda Paga com Sucesso!"
[PUSH LOG] O pagamento de João Silva foi confirmado (SIMULADO).
```

---

## 📚 EXEMPLOS

### Exemplo 1: Teste completo em localhost

```bash
# Terminal 1: Inicie o servidor
npm run dev

# Navegador 1: Gere QR Code
# 1. Acesse http://localhost:3000
# 2. Selecione um produto
# 3. Preencha dados
# 4. Clique em "Gerar QR Code"
# 5. Copie o Transaction ID: TRX-20251116183542-3033

# Navegador 2: Simule webhook
# 1. Acesse http://localhost:3000/admin
# 2. F12 → Console
# 3. Execute:

const tokenResp = await fetch('/api/csrf-token');
const { csrfToken } = await tokenResp.json();

const resp = await fetch('/api/simulate-webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'CSRF-Token': csrfToken
  },
  body: JSON.stringify({
    transactionId: 'TRX-20251116183542-3033'
  })
});

console.log(await resp.json());

# Navegador 1: Volte para a página do QR Code
# → Deve mostrar "Obrigado pela compra!" em 5 segundos
```

### Exemplo 2: Diagnóstico de problema

```bash
# Se a página não atualizou:

# 1. Verifique o Transaction ID
# Acesse: http://localhost:3000/api/debug-payment/SEU-TRANSACTION-ID

# 2. Verifique o status
# Se "status": "Gerado" → webhook não foi recebido
# Se "status": "Sucesso" → problema no polling (F12 → Network)

# 3. Verifique logs do servidor
# Procure por:
# - [WEBHOOK LOG] (deve aparecer se webhook chegou)
# - [STATUS CHECK] (deve aparecer a cada 5 segundos)
```

---

## 🎯 RESUMO

**Para desenvolver localmente:**
1. Use `/api/simulate-webhook` para simular pagamentos ✅
2. Não precisa de ngrok para testes rápidos ✅

**Para testes com Pix real:**
1. Use ngrok para criar túnel público ✅
2. Atualize WEBHOOK_URL e reinicie servidor ✅

**Para produção:**
1. Deploy em servidor com URL pública ✅
2. Configure WEBHOOK_URL permanentemente ✅

---

**Última atualização:** 16 de Novembro de 2025
