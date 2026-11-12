'use strict';

// Ícone do app, usado pela janela e pelas notificações. Se o arquivo faltar, o app segue sem ícone.
const fs = require('node:fs');
const path = require('node:path');
const { nativeImage } = require('electron');

const ARQUIVO_ICONE = path.join(__dirname, '..', 'assets', 'icone.png');

let icone; // undefined = ainda não lido; null = não deu para ler

function iconeDoApp() {
  if (icone === undefined) {
    try {
      icone = nativeImage.createFromBuffer(fs.readFileSync(ARQUIVO_ICONE));
      if (icone.isEmpty()) icone = null;
    } catch {
      icone = null;
    }
  }
  return icone || undefined;
}

module.exports = { ARQUIVO_ICONE, iconeDoApp };
