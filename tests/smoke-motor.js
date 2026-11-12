'use strict';

// Teste de fumaça do executor de userscripts com o Electron de verdade:
//   DM_DATA_DIR=<pasta> npx electron tests/smoke-motor.js --no-sandbox --ozone-platform=headless --disable-gpu
// Carrega o WhatsApp Web numa conta, injeta um userscript de teste e confere o resultado na página.

const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ScriptManager } = require('../src/motor');

const TEXTO = `// ==UserScript==
// @name         Marca de teste
// @match        https://web.whatsapp.com/*
// @run-at       document-end
// ==/UserScript==
document.documentElement.setAttribute('data-motor', 'ok');
`;

function fail(msg) {
  console.error('FALHOU:', msg);
  app.exit(1);
}

app.whenReady().then(async () => {
  try {
    const dados = process.env.DM_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dm-motor-smoke-'));
    const motor = new ScriptManager({ dataDir: dados });
    if (!motor.list().some((s) => s.name === 'Marca de teste')) motor.add(TEXTO);

    const ses = session.fromPartition('persist:motor-smoke');
    ses.setUserAgent(`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
    const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } });

    let injetados = null;
    win.webContents.on('dom-ready', async () => {
      injetados = await motor.injetar(win.webContents);
    });

    await win.loadURL('https://web.whatsapp.com/').catch((e) => console.log('aviso loadURL:', e.message));
    await new Promise((r) => setTimeout(r, 6000));

    const marca = await win.webContents.executeJavaScript(
      'document.documentElement.getAttribute("data-motor")'
    );
    console.log('scripts injetados:', JSON.stringify(injetados));
    console.log('marca na página:', marca);

    if (!injetados || !injetados.includes('Marca de teste')) return fail('script não foi injetado');
    if (marca !== 'ok') return fail('script injetado não alterou a página');

    console.log('OK: userscript injetado e executado no WhatsApp Web');
    app.exit(0);
  } catch (err) {
    fail(err.stack || err.message);
  }
});
