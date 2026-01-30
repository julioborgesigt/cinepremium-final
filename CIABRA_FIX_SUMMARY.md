# Correção do Erro CIABRA - Resumo das Mudanças

## Problema Identificado

O código estava enviando um objeto `customer` inline no payload do invoice, mas a API CIABRA requer um `customerId` (UUID de um cliente já cadastrado no sistema).

### Erro Original
```
TypeError: Cannot read properties of undefined (reading 'map')
```

Este erro ocorria porque a API retornava um erro de validação que não estava sendo tratado corretamente.

## Mudanças Implementadas

### 1. Nova Função: `createCiabraCustomer()` (linhas 868-896)

Criada função para cadastrar clientes no CIABRA antes de criar o invoice:

```javascript
async function createCiabraCustomer(customerData) {
  const authToken = getCiabraAuthToken();
  if (!authToken) {
    throw new Error('Credenciais CIABRA não configuradas');
  }

  try {
    const response = await axios.post(
      `${CIABRA_API_URL}/invoices/applications/customers`, 
      customerData, 
      {
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('[CIABRA] Erro ao criar cliente:', error.response?.data || error.message);
    throw error;
  }
}
```

### 2. Modificação no Endpoint `/gerarqrcode` (linhas 1302-1324)

**Antes:**
```javascript
const customerData = {
  name: String(nome),
  email: String(sanitizedEmail),
  document: cleanDocument
};

const ciabraPayload = {
  // ... outros campos
  customer: customerData,  // ❌ ERRADO
  // ...
};
```

**Depois:**
```javascript
// Preparar dados no formato correto para API de customers
const customerDataForCreation = {
  fullName: String(nome),  // API usa fullName, não name
  email: String(sanitizedEmail),
  document: cleanDocument,
  phone: cleanPhone  // opcional
};

// Criar cliente primeiro
const customerResponse = await createCiabraCustomer(customerDataForCreation);
const customerId = customerResponse.id;

// Usar customerId no invoice
const ciabraPayload = {
  customerId: customerId,  // ✅ CORRETO
  // ... outros campos
  // ...
};
```

## Fluxo Corrigido

1. **Receber dados do formulário** (nome, email, CPF, telefone, etc.)
2. **Criar cliente no CIABRA** usando `createCiabraCustomer()`
3. **Obter `customerId`** da resposta
4. **Criar invoice** usando o `customerId`
5. **Extrair dados do PIX** da resposta (QR Code, código copia-cola)
6. **Retornar para o frontend**

## Campos da API CIABRA

### Endpoint de Customers: `/invoices/applications/customers`
```json
{
  "fullName": "string",      // ← fullName, não name
  "document": "string",       // CPF/CNPJ sem formatação
  "email": "string",          // opcional
  "phone": "string"           // opcional, formato: +5521999999999
}
```

### Endpoint de Invoices: `/invoices/applications/invoices`
```json
{
  "customerId": "uuid",       // ← UUID do cliente criado
  "description": "string",
  "dueDate": "ISO date",
  "installmentCount": 1,
  "invoiceType": "SINGLE",
  "items": [...],
  "price": 10.00,             // em REAIS, não centavos
  "externalId": "string",
  "paymentTypes": ["PIX"],
  "webhooks": [...]
}
```

## Próximos Passos (Recomendações)

### 1. Otimização: Cache de Clientes
Para evitar criar clientes duplicados a cada compra, considere:
- Verificar se cliente já existe (por CPF/email) antes de criar
- Armazenar mapeamento CPF → customerId no banco de dados
- Reutilizar customerId existente

### 2. Tratamento de Duplicatas
A API pode retornar erro 409 (Conflict) se o cliente já existir. Considere:
- Capturar erro 409 e buscar cliente existente
- Usar endpoint de busca de clientes se disponível

### 3. Validação de Telefone
A API pode ter requisitos específicos para formato de telefone:
- Formato internacional: `+5521999999999`
- Validar antes de enviar

## Teste Recomendado

1. Acessar página de venda
2. Selecionar gateway CIABRA
3. Preencher formulário com dados válidos
4. Clicar em "Gerar QR Code"
5. Verificar logs do servidor para confirmar:
   - Cliente criado com sucesso
   - Invoice criado com sucesso
   - QR Code retornado

## Logs Esperados

```
[CIABRA DEBUG] ====== INÍCIO DO PROCESSAMENTO ======
[CIABRA DEBUG] Valores recebidos: ...
[CIABRA DEBUG] Customer data for creation: { fullName: "...", ... }
[CIABRA DEBUG] Criando cliente no CIABRA...
[CIABRA] Criando cliente...
[CIABRA] Cliente criado com sucesso: { id: "uuid-...", ... }
[CIABRA DEBUG] Cliente criado com ID: uuid-...
[CIABRA DEBUG] ====== PAYLOAD FINAL ======
{ customerId: "uuid-...", ... }
[CIABRA] Criando cobrança...
[CIABRA] Resposta recebida: { id: "...", installments: [...] }
```
