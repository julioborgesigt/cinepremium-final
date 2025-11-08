#!/bin/bash
# Script para verificar se o arquivo .env está seguro

echo "🔒 Verificando segurança do arquivo .env..."
echo ""

# Verifica se .env existe
if [ ! -f .env ]; then
    echo "ℹ️  Arquivo .env não existe (isso é OK se você usa env_var_list do YML)"
    echo ""
    exit 0
fi

echo "📍 Localização do .env:"
pwd
ls -la .env
echo ""

# Verifica permissões
PERMS=$(stat -c '%a' .env 2>/dev/null || stat -f '%A' .env 2>/dev/null)
echo "🔐 Permissões atuais: $PERMS"

if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
    echo "   ✅ Permissões SEGURAS (apenas dono pode ler)"
elif [ "$PERMS" = "640" ] || [ "$PERMS" = "440" ]; then
    echo "   ⚠️  Permissões ACEITÁVEIS (dono e grupo podem ler)"
else
    echo "   ❌ PERIGO: Permissões muito abertas!"
    echo "   Execute: chmod 600 .env"
fi
echo ""

# Verifica se está dentro da pasta pública
PUBLIC_DIR="public_html/public"
if [[ "$(pwd)" == *"$PUBLIC_DIR"* ]]; then
    echo "❌ PERIGO CRÍTICO: .env está dentro da pasta pública!"
    echo "   Pode ser acessível via: https://seu-dominio.com/.env"
    echo ""
    echo "   SOLUÇÃO: Mova o .env para public_html (fora de public/)"
    echo "   Execute: mv .env ../.env"
    echo ""
    exit 1
fi

# Verifica se nginx está configurado para bloquear .env
echo "🌐 Verificando proteção do Nginx..."
if [ -f "../nginx.conf" ] || [ -f "/etc/nginx/nginx.conf" ]; then
    echo "   ℹ️  Configuração Nginx encontrada"
    echo "   No DomCloud, arquivos começando com '.' geralmente são bloqueados"
else
    echo "   ℹ️  Não foi possível verificar configuração Nginx"
fi
echo ""

# Teste se .env é acessível via web (se curl estiver disponível)
if command -v curl &> /dev/null; then
    DOMAIN=$(grep -oP 'ALLOWED_ORIGINS=\K[^,]+' .env 2>/dev/null | head -1)
    if [ ! -z "$DOMAIN" ]; then
        echo "🧪 Testando se .env é acessível via web..."
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$DOMAIN/.env" 2>/dev/null)

        if [ "$HTTP_CODE" = "200" ]; then
            echo "   ❌ PERIGO CRÍTICO: .env está ACESSÍVEL publicamente!"
            echo "   Código HTTP: $HTTP_CODE"
        elif [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "403" ]; then
            echo "   ✅ SEGURO: .env NÃO está acessível (HTTP $HTTP_CODE)"
        else
            echo "   ℹ️  Código HTTP: $HTTP_CODE (verifique manualmente)"
        fi
    fi
fi
echo ""

# Recomendações finais
echo "📋 Checklist de Segurança:"
echo ""
echo "   [ ] .env está em public_html/ (NÃO em public_html/public/)"
echo "   [ ] Permissões são 600 ou 400"
echo "   [ ] .env está no .gitignore"
echo "   [ ] Teste manual: https://seu-dominio.com/.env retorna 404"
echo ""

# Verificar se está no .gitignore
if [ -f .gitignore ]; then
    if grep -q "^\.env$" .gitignore || grep -q "^\.env\*" .gitignore; then
        echo "   ✅ .env está no .gitignore"
    else
        echo "   ⚠️  .env pode NÃO estar no .gitignore"
    fi
fi
echo ""

echo "✅ Verificação concluída!"
