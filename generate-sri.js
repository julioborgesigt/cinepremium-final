#!/usr/bin/env node
/**
 * Script para gerar hashes SRI (Subresource Integrity) para scripts CDN
 *
 * Uso: node generate-sri.js
 *
 * Este script baixa os scripts CDN usados no projeto e gera os hashes
 * SHA-384 necessários para o atributo integrity="" nas tags <script>
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

// URLs dos scripts CDN usados no projeto
const cdnScripts = [
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js'
];

/**
 * Gera hash SRI para uma URL
 */
function generateSRI(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const hash = crypto.createHash('sha384');

      res.on('data', (chunk) => {
        hash.update(chunk);
      });

      res.on('end', () => {
        const sriHash = hash.digest('base64');
        resolve({
          url,
          integrity: `sha384-${sriHash}`,
          crossorigin: 'anonymous'
        });
      });
    }).on('error', reject);
  });
}

/**
 * Gera todos os hashes SRI
 */
async function generateAllSRI() {
  console.log('🔒 Gerando hashes SRI para scripts CDN...\n');

  for (const url of cdnScripts) {
    try {
      const sri = await generateSRI(url);

      console.log(`✅ ${url}`);
      console.log(`   integrity="${sri.integrity}"`);
      console.log(`   crossorigin="${sri.crossorigin}"`);
      console.log('');

      // Gera tag <script> completa
      const scriptTag = `<script src="${url}" integrity="${sri.integrity}" crossorigin="${sri.crossorigin}"></script>`;
      console.log(`   Tag completa:`);
      console.log(`   ${scriptTag}`);
      console.log('');
      console.log('---');
      console.log('');
    } catch (error) {
      console.error(`❌ Erro ao gerar SRI para ${url}:`);
      console.error(`   ${error.message}`);
      console.log('');
      console.log('   💡 Alternativa: Use https://www.srihash.org/ para gerar manualmente');
      console.log('');
      console.log('---');
      console.log('');
    }
  }

  console.log('✨ Processo concluído!');
  console.log('');
  console.log('📝 Instruções:');
  console.log('1. Copie os atributos integrity e crossorigin gerados acima');
  console.log('2. Adicione-os às tags <script> correspondentes em public/admin.html');
  console.log('3. Adicione-os aos importScripts() em public/firebase-messaging-sw.js (se suportado)');
  console.log('');
  console.log('⚠️  Nota sobre Firebase:');
  console.log('   Os scripts do Firebase (gstatic.com) podem não suportar SRI devido a');
  console.log('   atualizações frequentes. Se encontrar erros, remova o SRI apenas desses scripts.');
}

// Executa
generateAllSRI().catch(console.error);
