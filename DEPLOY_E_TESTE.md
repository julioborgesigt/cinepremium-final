# Guia de Deploy e Teste - Correção CIABRA

## ✅ Mudanças Implementadas

As correções foram aplicadas ao arquivo `server.js` e já foram enviadas para o repositório GitHub.

**Commit:** `9c1228c - Fix CIABRA integration: Create customer before invoice`

## 📋 Próximos Passos para Deploy

### 1. Atualizar o Servidor de Produção

Se você está usando DOMCloud ou outro serviço de hospedagem:

```bash
# SSH no servidor
ssh usuario@seu-servidor.domcloud.dev

# Navegar para o diretório do projeto
cd /caminho/para/cinepremium-final

# Fazer pull das mudanças
git pull origin main

# Reiniciar o servidor Node.js
# (O comando varia dependendo do seu setup)
pm2 restart cinepremium
# ou
systemctl restart cinepremium
# ou simplesmente reinicie o processo Node.js
```

### 2. Verificar Variáveis de Ambiente

Certifique-se de que as credenciais do CIABRA estão configuradas:

```bash
CIABRA_API_URL=https://api.az.center
CIABRA_PUBLIC_KEY=sua_chave_publica
CIABRA_PRIVATE_KEY=sua_chave_privada
CIABRA_WEBHOOK_URL=https://seu-dominio.com/ciabra-webhook
```

### 3. Testar a Integração

1. **Acesse a página de venda**: https://cinepremiumedit.domcloud.dev/
2. **Selecione o gateway CIABRA** nas configurações
3. **Preencha o formulário** com dados de teste:
   - Nome: João da Silva
   - Email: joao@teste.com
   - CPF: 123.456.789-00 (use CPF válido)
   - Telefone: (21) 99999-9999
   - Selecione um produto

4. **Clique em "Gerar QR Code"**

5. **Verifique os logs do servidor**:
```bash
# Ver logs em tempo real
pm2 logs cinepremium
# ou
tail -f /var/log/cinepremium.log
```

### 4. Logs Esperados (Sucesso)

```
[CIABRA DEBUG] ====== INÍCIO DO PROCESSAMENTO ======
[CIABRA DEBUG] Valores recebidos:
  - value: "1000" (type: number)
  - nome: "João da Silva"
  - telefone: "21999999999"
  - cpf: "12345678900"
  - email: "joao@teste.com"
[CIABRA DEBUG] Customer data for creation: {
  "fullName": "João da Silva",
  "email": "joao@teste.com",
  "document": "12345678900",
  "phone": "21999999999"
}
[CIABRA DEBUG] Criando cliente no CIABRA...
[CIABRA] Criando cliente...
[CIABRA] Cliente criado com sucesso: {
  "id": "cf577c52-ce82-48cf-a089-16b2f62eedb6",
  ...
}
[CIABRA DEBUG] Cliente criado com ID: cf577c52-ce82-48cf-a089-16b2f62eedb6
[CIABRA DEBUG] ====== PAYLOAD FINAL ======
{
  "customerId": "cf577c52-ce82-48cf-a089-16b2f62eedb6",
  "description": "Produto - ",
  "dueDate": "2026-01-30T18:30:00.000Z",
  "installmentCount": 1,
  "invoiceType": "SINGLE",
  "items": [
    {
      "description": "Produto",
      "quantity": 1,
      "price": 10.00
    }
  ],
  "price": 10.00,
  "externalId": "123",
  "paymentTypes": ["PIX"],
  "webhooks": [...]
}
[CIABRA] Criando cobrança...
[CIABRA] Resposta recebida: {
  "id": "invoice-uuid",
  "installments": [
    {
      "payments": [
        {
          "pixCode": "00020126...",
          "qrCodeBase64": "iVBORw0KGgo..."
        }
      ]
    }
  ]
}
[GERARQRCODE] ✅ QR Code gerado com sucesso (ciabra): invoice-uuid
```

## 🔍 Troubleshooting

### Erro: "Credenciais CIABRA não configuradas"

**Solução**: Verifique se as variáveis de ambiente estão configuradas corretamente.

```bash
# Verificar variáveis
echo $CIABRA_PUBLIC_KEY
echo $CIABRA_PRIVATE_KEY
```

### Erro: "Cliente já existe" (409 Conflict)

**Comportamento Esperado**: Se o cliente já foi criado anteriormente com o mesmo CPF/email, a API pode retornar erro 409.

**Solução Temporária**: O código atual vai lançar erro. Para produção, considere implementar:
- Buscar cliente existente por CPF antes de criar
- Armazenar mapeamento CPF → customerId no banco de dados

### Erro: "Invalid phone format"

**Solução**: Certifique-se de que o telefone está no formato internacional:
- Correto: `+5521999999999`
- Incorreto: `(21) 99999-9999`

O código já faz a limpeza, mas a API pode ter requisitos específicos.

## 📊 Validação de Sucesso

A integração está funcionando corretamente quando:

1. ✅ Cliente é criado no CIABRA sem erros
2. ✅ Invoice é criado com o `customerId` correto
3. ✅ QR Code PIX é retornado (código copia-cola + imagem base64)
4. ✅ Frontend exibe o QR Code para pagamento
5. ✅ Webhook recebe notificação quando pagamento é confirmado

## 🚀 Melhorias Futuras Recomendadas

### 1. Cache de Clientes
```javascript
// Verificar se cliente já existe antes de criar
const existingCustomer = await findCustomerByCPF(cpf);
if (existingCustomer) {
  customerId = existingCustomer.id;
} else {
  const customerResponse = await createCiabraCustomer(customerDataForCreation);
  customerId = customerResponse.id;
  // Salvar no banco para reutilizar
  await saveCustomerMapping(cpf, customerId);
}
```

### 2. Retry Logic
```javascript
// Tentar novamente se falhar por erro temporário
let retries = 3;
while (retries > 0) {
  try {
    const customerResponse = await createCiabraCustomer(customerDataForCreation);
    break;
  } catch (error) {
    if (error.response?.status >= 500 && retries > 1) {
      retries--;
      await sleep(1000);
      continue;
    }
    throw error;
  }
}
```

### 3. Validação de Telefone
```javascript
// Garantir formato internacional
function formatPhoneForCiabra(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `+55${cleaned}`;
  }
  return cleaned;
}
```

## 📞 Suporte

Se encontrar problemas após o deploy:

1. **Verifique os logs** do servidor para mensagens de erro detalhadas
2. **Teste com dados diferentes** para isolar o problema
3. **Consulte a documentação do CIABRA**: https://docs.ciabra.com.br
4. **Verifique o status da API**: Pode haver instabilidade temporária

## 📝 Checklist de Deploy

- [ ] Pull das mudanças do GitHub
- [ ] Verificar variáveis de ambiente CIABRA
- [ ] Reiniciar servidor Node.js
- [ ] Testar criação de QR Code com gateway CIABRA
- [ ] Verificar logs para confirmar sucesso
- [ ] Testar pagamento completo (opcional, com valor real)
- [ ] Verificar recebimento de webhook após pagamento
