// Script simples para verificar se as variáveis de ambiente estão configuradas
console.log('🔍 Verificando variáveis de ambiente...\n');

const requiredVars = [
  'REDIS_URL',
  'DB_HOST',
  'DB_USER',
  'DB_NAME',
  'SESSION_SECRET',
  'ONDAPAY_EMAIL',
  'ONDAPAY_PASSWORD',
  'WEBHOOK_URL'
];

const optionalVars = [
  'NODE_ENV',
  'PORT',
  'ALLOWED_ORIGINS',
  'FIREBASE_PROJECT_ID'
];

console.log('📋 Variáveis OBRIGATÓRIAS:\n');
let missingRequired = [];

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    // Mascara valores sensíveis
    const masked = varName.includes('PASSWORD') || varName.includes('SECRET') || varName.includes('URL')
      ? value.substring(0, 10) + '...'
      : value;
    console.log(`   ✅ ${varName} = ${masked}`);
  } else {
    console.log(`   ❌ ${varName} = NÃO DEFINIDO`);
    missingRequired.push(varName);
  }
});

console.log('\n📋 Variáveis OPCIONAIS:\n');

optionalVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    console.log(`   ✅ ${varName} = ${value}`);
  } else {
    console.log(`   ⚠️  ${varName} = não definido (usando padrão)`);
  }
});

if (missingRequired.length > 0) {
  console.log('\n❌ ERRO: Variáveis obrigatórias faltando:', missingRequired.join(', '));
  console.log('\n💡 Configure no painel DomCloud:');
  console.log('   1. Acesse seu domínio no painel');
  console.log('   2. Vá em "Deployment" ou "Environment Variables"');
  console.log('   3. Adicione as variáveis faltantes\n');
  process.exit(1);
} else {
  console.log('\n✅ TODAS as variáveis obrigatórias estão configuradas!\n');
}
