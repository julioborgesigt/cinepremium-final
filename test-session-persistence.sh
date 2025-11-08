#!/bin/bash
# Script para testar persistência de sessão após restart

echo "🧪 Teste de Persistência de Sessão Redis"
echo "=========================================="
echo ""

# Verifica se Redis está configurado
if [ -z "$REDIS_URL" ]; then
    echo "⚠️  REDIS_URL não está definido no ambiente"
    echo "   Este teste só funciona se Redis estiver configurado"
    echo ""
    read -p "Deseja continuar mesmo assim? (s/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        exit 1
    fi
fi

# Passo 1: Verificar sessões antes do restart
echo "📊 Passo 1: Verificando sessões ANTES do restart..."
echo ""

if command -v node &> /dev/null; then
    node test-redis-connection.js 2>/dev/null || echo "   (Execute npm run test-redis-domcloud para ver detalhes)"
fi

echo ""
read -p "▶️  Você está LOGADO no painel admin? (s/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "❌ Por favor, faça login em https://seu-dominio.com/login primeiro"
    exit 1
fi

echo "✅ Login confirmado"
echo ""

# Passo 2: Restart
echo "🔄 Passo 2: Reiniciando servidor..."
echo ""

# Cria diretório tmp se não existir
mkdir -p tmp

# Método Passenger
touch tmp/restart.txt
echo "   ✅ Arquivo tmp/restart.txt tocado"
echo "   ⏳ Aguardando 5 segundos para Passenger reiniciar..."
sleep 5

echo "   ✅ Servidor reiniciado"
echo ""

# Passo 3: Verificar se sessão persistiu
echo "📊 Passo 3: Verificando se sessão ainda existe..."
echo ""

if command -v node &> /dev/null; then
    node test-redis-connection.js 2>/dev/null || echo "   (Execute npm run test-redis-domcloud para ver detalhes)"
fi

echo ""
echo "🌐 Passo 4: Teste manual necessário"
echo ""
echo "   Abra no navegador: https://seu-dominio.com/admin"
echo ""
read -p "▶️  Você ainda está LOGADO? (s/n) " -n 1 -r
echo ""
echo ""

if [[ $REPLY =~ ^[Ss]$ ]]; then
    echo "✅ SUCESSO! Redis está funcionando corretamente!"
    echo ""
    echo "   🎉 Sessão persistiu após o restart"
    echo "   🎉 Redis está armazenando sessões como esperado"
    echo "   🎉 Deploy em produção pode prosseguir com segurança"
    echo ""
else
    echo "❌ FALHA! Redis NÃO está funcionando"
    echo ""
    echo "   Possíveis causas:"
    echo "   1. REDIS_URL não está configurado corretamente"
    echo "   2. Redis não conseguiu conectar"
    echo "   3. Aplicação está usando MemoryStore (fallback)"
    echo ""
    echo "   Verifique os logs do servidor:"
    echo "   tail -f ~/logs/passenger.log"
    echo ""
    exit 1
fi
