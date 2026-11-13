'use strict';

// Gera o .sha256 de cada pacote (AppImage, deb, rpm, exe) em dist/<versão>/.
// Uso: node scripts/sha256.js   (a versão vem do package.json)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { version } = require('../package.json');
const pasta = path.join(__dirname, '..', 'dist', version);
const PACOTES = /\.(AppImage|deb|rpm|exe)$/;

for (const nome of fs.readdirSync(pasta).filter((n) => PACOTES.test(n))) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(pasta, nome))).digest('hex');
  fs.writeFileSync(path.join(pasta, `${nome}.sha256`), `${hash}  ${nome}\n`);
  console.log(`${hash}  ${nome}`);
}
