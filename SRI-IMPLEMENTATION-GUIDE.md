# Guia de Implementação SRI (Subresource Integrity)

**Data:** 16 de Novembro de 2025
**Status:** ⚠️ Infraestrutura pronta, hashes pendentes

---

## 📋 O QUE É SRI?

**Subresource Integrity (SRI)** é um recurso de segurança que permite aos navegadores verificar que arquivos carregados de CDNs não foram adulterados.

Quando um script CDN possui um hash SRI, o navegador:
1. Baixa o script do CDN
2. Calcula o hash SHA-384 do arquivo baixado
3. Compara com o hash fornecido no atributo `integrity`
4. Se **NÃO bater** → Bloqueia execução (previne ataque)
5. Se **bater** → Executa normalmente

### Exemplo de Ataque Prevenido por SRI

**Sem SRI:**
```html
<script src="https://cdn.example.com/library.js"></script>
```
❌ Se o CDN for comprometido, código malicioso pode ser injetado

**Com SRI:**
```html
<script src="https://cdn.example.com/library.js"
        integrity="sha384-abc123..."
        crossorigin="anonymous"></script>
```
✅ Se o CDN for comprometido, o navegador detecta a alteração e bloqueia o script

---

## 🎯 ESTADO ATUAL

### ✅ O que foi implementado

1. **Atributo `crossorigin="anonymous"`** adicionado a todos os scripts CDN
   - Necessário para SRI funcionar
   - Habilita CORS para verificação

2. **Script gerador de hashes:** `generate-sri.js`
   - Automatiza geração de hashes SRI
   - Pronto para uso em ambiente com internet

3. **Comentários documentados** nos arquivos HTML
   - Instruções claras de como adicionar hashes
   - Referências ao script gerador

### ⏳ O que está pendente

**Gerar os hashes SHA-384** para os 3 scripts CDN:
- `firebase-app-compat.js` (v10.7.0)
- `firebase-messaging-compat.js` (v10.7.0)
- `Sortable.min.js` (v1.15.0)

**Por que está pendente?**
- Ambiente de desenvolvimento tem restrições de rede
- CDNs bloqueiam acesso programático (403 Forbidden)
- DNS resolution falha (getaddrinfo EAI_AGAIN)

**Solução:** Gerar hashes em ambiente local/produção com acesso à internet

---

## 🚀 COMO COMPLETAR A IMPLEMENTAÇÃO

### Opção 1: Script Automatizado (Recomendado)

**No seu ambiente local com internet:**

```bash
# 1. Execute o script gerador
node generate-sri.js

# 2. O script imprimirá algo como:
# ✅ https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js
#    integrity="sha384-Zx8qzX..."
#    crossorigin="anonymous"
#
#    Tag completa:
#    <script src="..." integrity="sha384-Zx8qzX..." crossorigin="anonymous"></script>

# 3. Copie os atributos integrity gerados
```

**Adicione aos arquivos:**

`public/admin.html` (linhas 285-287):
```html
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js"
        integrity="sha384-HASH_GERADO_AQUI"
        crossorigin="anonymous"></script>
<script src="https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js"
        integrity="sha384-HASH_GERADO_AQUI"
        crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"
        integrity="sha384-HASH_GERADO_AQUI"
        crossorigin="anonymous"></script>
```

---

### Opção 2: SRI Hash Generator Online

Use o site **https://www.srihash.org/**:

1. Cole a URL do script CDN
2. Clique em "Hash!"
3. Copie o atributo `integrity="sha384-..."`
4. Adicione ao HTML

**URLs para processar:**
- https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js
- https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js
- https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js

---

### Opção 3: Gerar Manualmente (Linux/Mac)

```bash
# Baixar script e gerar hash
curl -s https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js | \
  openssl dgst -sha384 -binary | \
  openssl base64 -A

# Resultado: abc123def456...
# Use como: integrity="sha384-abc123def456..."
```

---

## ⚠️ IMPORTANTE: Firebase e SRI

### Problema Conhecido

Os scripts do Firebase hospedados em `www.gstatic.com` **podem não funcionar bem com SRI** porque:

1. **Atualizações frequentes:** Google atualiza scripts sem aviso
2. **Cache agressivo:** CDN pode servir versões diferentes
3. **Sem suporte oficial:** Firebase não documenta hashes SRI

### Soluções

#### Solução 1: Tentar com SRI (Recomendado primeiro)
```html
<!-- Tente adicionar SRI -->
<script src="..." integrity="sha384-..." crossorigin="anonymous"></script>
```
- ✅ Se funcionar: Ótimo! Segurança máxima
- ❌ Se quebrar: Remova apenas o `integrity` (mantenha `crossorigin`)

#### Solução 2: SRI apenas para SortableJS
```html
<!-- Firebase SEM SRI (Google atualiza frequentemente) -->
<script src="firebase..." crossorigin="anonymous"></script>

<!-- SortableJS COM SRI (versão fixa) -->
<script src="sortablejs..." integrity="sha384-..." crossorigin="anonymous"></script>
```

#### Solução 3: Self-hosting (Máxima segurança)
```bash
# Baixe os scripts e sirva do seu servidor
mkdir -p public/vendor
curl -o public/vendor/sortable.min.js https://cdn.jsdelivr.net/.../Sortable.min.js

# No HTML:
<script src="/vendor/sortable.min.js"></script>
```
✅ Controle total
✅ SRI não necessário (scripts são seus)
❌ Precisa atualizar manualmente

---

## 📊 BENEFÍCIOS DA IMPLEMENTAÇÃO

| Benefício | Descrição |
|-----------|-----------|
| **Proteção contra CDN comprometido** | Se o CDN for hackeado, scripts maliciosos são bloqueados |
| **Detecção de MITM** | Ataques man-in-the-middle que alteram scripts são detectados |
| **Compliance** | Atende requisitos de segurança OWASP e PCI-DSS |
| **Transparência** | Usuário vê no console se script foi bloqueado |

---

## 🧪 COMO TESTAR

### 1. Adicione os hashes SRI conforme instruções acima

### 2. Acesse `/admin` no navegador

### 3. Abra o Console (F12)

**Sucesso (SRI funcionando):**
```
✅ Nenhum erro
✅ Página carrega normalmente
✅ Arrastar produtos funciona (SortableJS carregou)
```

**Falha (hash incorreto):**
```
❌ Failed to find a valid digest in the 'integrity' attribute
❌ Script bloqueado
❌ Funcionalidades quebradas
```

### 4. Se der erro:

- **Verifique o hash:** Regere usando `node generate-sri.js`
- **Teste sem Firebase SRI:** Remova `integrity` apenas dos scripts Firebase
- **Verifique versões:** Certifique-se que as versões batem (10.7.0, 1.15.0)

---

## 📝 CHECKLIST DE IMPLEMENTAÇÃO

- [x] Adicionar `crossorigin="anonymous"` a todos os scripts CDN
- [x] Criar script `generate-sri.js` para gerar hashes
- [x] Documentar implementação neste arquivo
- [ ] **PENDENTE:** Executar `node generate-sri.js` em ambiente com internet
- [ ] **PENDENTE:** Adicionar hashes `integrity` aos scripts em `public/admin.html`
- [ ] **PENDENTE:** Testar no navegador
- [ ] **PENDENTE:** Decidir sobre Firebase (com ou sem SRI)

---

## 🔗 REFERÊNCIAS

- **MDN Web Docs:** https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
- **SRI Hash Generator:** https://www.srihash.org/
- **Can I Use SRI:** https://caniuse.com/subresource-integrity
- **OWASP SRI:** https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html

---

## 📌 RESUMO

| Item | Status |
|------|--------|
| Infraestrutura (crossorigin) | ✅ Completo |
| Script gerador | ✅ Criado |
| Documentação | ✅ Completa |
| Hashes SRI | ⏳ **Pendente (requer internet)** |

**Próximo passo:** Execute `node generate-sri.js` em um ambiente com acesso à internet e adicione os hashes gerados aos scripts em `public/admin.html`.

**Tempo estimado:** 10-15 minutos

---

**Última atualização:** 16 de Novembro de 2025
