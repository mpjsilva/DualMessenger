'use strict';

// Remove o que o electron-builder deixa de intermediário em dist/<versão>/ (só os pacotes ficam).
const fs = require('node:fs');
const path = require('node:path');

const { version } = require('../package.json');
const pasta = path.join(__dirname, '..', 'dist', version);
const SOBRAS = ['linux-unpacked', 'win-unpacked', 'builder-debug.yml', 'builder-effective-config.yaml', 'latest-linux.yml', 'latest.yml'];

for (const nome of SOBRAS) fs.rmSync(path.join(pasta, nome), { recursive: true, force: true });
for (const nome of fs.existsSync(pasta) ? fs.readdirSync(pasta) : []) {
  if (nome.endsWith('.nsis.7z')) fs.rmSync(path.join(pasta, nome), { force: true });
}
