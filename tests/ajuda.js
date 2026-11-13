'use strict';

// Pastas temporárias dos testes: todas ficam dentro de uma única pasta e somem quando o processo termina.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let raiz = null;

function pastaTemp(prefixo) {
  if (!raiz) {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-messenger-testes-'));
    process.on('exit', () => {
      try { fs.rmSync(raiz, { recursive: true, force: true }); } catch { /* melhor esforço */ }
    });
  }
  return fs.mkdtempSync(path.join(raiz, prefixo));
}

module.exports = { pastaTemp };
