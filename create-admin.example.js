// Script para criar primeiro usuário administrador no banco de dados
// Execute: node create-admin.example.js

require('dotenv').config();
const bcrypt = require('bcrypt');
const { User, sequelize } = require('./models');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function createAdminUser() {
  console.log('\n===========================================');
  console.log('📝 CRIAR USUÁRIO ADMINISTRADOR');
  console.log('===========================================\n');

  try {
    // Verificar se já existe admin
    const existingAdmin = await User.findOne({ where: { role: 'admin' } });

    if (existingAdmin) {
      console.log('⚠️  Já existe um usuário admin no banco:');
      console.log(`   Username: ${existingAdmin.username}`);
      console.log(`   Email: ${existingAdmin.email}\n`);

      const confirm = await question('Deseja criar outro admin? (s/n): ');
      if (confirm.toLowerCase() !== 's') {
        console.log('❌ Operação cancelada.');
        process.exit(0);
      }
    }

    // Coletar dados
    console.log('\n📋 Preencha os dados do novo administrador:\n');

    const username = await question('Username: ');
    if (!username || username.length < 3) {
      console.log('❌ Username deve ter no mínimo 3 caracteres.');
      process.exit(1);
    }

    const email = await question('Email: ');
    if (!email || !email.includes('@')) {
      console.log('❌ Email inválido.');
      process.exit(1);
    }

    const password = await question('Senha (mín 8 caracteres): ');
    if (!password || password.length < 8) {
      console.log('❌ Senha deve ter no mínimo 8 caracteres.');
      process.exit(1);
    }

    const passwordConfirm = await question('Confirme a senha: ');
    if (password !== passwordConfirm) {
      console.log('❌ Senhas não conferem.');
      process.exit(1);
    }

    // Criar hash bcrypt
    console.log('\n🔐 Gerando hash bcrypt...');
    const passwordHash = await bcrypt.hash(password, 10);

    // Criar usuário
    console.log('💾 Criando usuário no banco...');

    const user = await User.create({
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      password: passwordHash,
      role: 'admin',
      isActive: true
    });

    console.log('\n✅ SUCESSO! Usuário administrador criado:\n');
    console.log(`   ID: ${user.id}`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Ativo: ${user.isActive ? 'Sim' : 'Não'}`);
    console.log(`   Criado em: ${user.createdAt}\n`);

    console.log('🔑 Você pode agora fazer login com:');
    console.log(`   Username: ${user.username}`);
    console.log(`   Senha: (a que você digitou)\n`);

  } catch (error) {
    console.error('\n❌ ERRO ao criar usuário:', error.message);

    if (error.name === 'SequelizeUniqueConstraintError') {
      console.log('\n⚠️  Username ou email já existe no banco.');
    }

    process.exit(1);
  } finally {
    rl.close();
    await sequelize.close();
  }
}

// Executar
createAdminUser();
