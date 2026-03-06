const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputPath = path.join(__dirname, '../public/cinepremium2.png');
const outputPath = path.join(__dirname, '../public/cinepremium2.webp');

console.log(`Lendo: ${inputPath}`);
console.log(`Gravando: ${outputPath}`);

sharp(inputPath)
    .webp({ quality: 80 })
    .toFile(outputPath)
    .then(info => {
        console.log('✅ Imagem cinepremium2.png convertida para WebP com sucesso:', info);
    })
    .catch(err => {
        console.error('❌ Erro ao converter imagem:', err);
    });
