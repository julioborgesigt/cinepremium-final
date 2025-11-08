#!/bin/bash
# Script para testar Redis no DomCloud onde variáveis estão no Passenger

REDIS_URL="redis://default:QtOTZsKiYFXwW2lBsOai7qJpR7yWoTlb@redis-10480.crce207.sa-east-1-2.ec2.redns.redis-cloud.com:10480"

echo "🔍 Testando Redis no DomCloud..."
echo ""

node test-redis-connection.js "$REDIS_URL"
