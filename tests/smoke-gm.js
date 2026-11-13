'use strict';

// Teste de fumaça da API GM_* com o Electron de verdade (não roda no `npm test`):
//   npx electron tests/smoke-gm.js --no-sandbox --ozone-platform=headless --disable-gpu
// Usa uma página local, o mesmo preload e os mesmos canais IPC do app.

const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { ScriptManager } = require('../src/motor');
const { registerGmIpc } = require('../src/gm-ipc');
const { pastaTemp } = require('./ajuda');

function fail(msg) {
  console.error('FALHOU:', msg);
  app.exit(1);
}

app.whenReady().then(async () => {
  try {
    const servidor = http.createServer((req, res) => {
      if (req.url.startsWith('/eco')) return res.end('eco-ok');
      res.setHeader('content-type', 'text/html');
      res.end('<html><body></body></html>');
    });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const porta = servidor.address().port;
    const base = `http://127.0.0.1:${porta}`;

    const motor = new ScriptManager({ dataDir: pastaTemp('dm-gm-smoke-') });
    motor.add(`// ==UserScript==
// @name GM teste
// @match ${base}/*
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_xmlhttpRequest
// ==/UserScript==
GM_setValue('chave', 'valor-gm');
document.body.setAttribute('data-valor', GM_getValue('chave', 'padrao'));
GM_xmlhttpRequest({ method: 'GET', url: '${base}/eco', onload: function (r) {
  document.body.setAttribute('data-http', r.status + ':' + r.responseText);
}});
`);

    registerGmIpc(motor);
    const ses = session.fromPartition('persist:gm-smoke');
    ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, '..', 'src', 'preload-gm.js') });
    const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true } });

    let injetados = null;
    win.webContents.on('dom-ready', async () => {
      injetados = await motor.injetar(win.webContents);
    });
    await win.loadURL(`${base}/`);
    await new Promise((r) => setTimeout(r, 2500));

    const resultado = await win.webContents.executeJavaScript(`({
      valor: document.body.getAttribute('data-valor'),
      http: document.body.getAttribute('data-http'),
      ponteExiste: typeof window.__dmGM,
      semToken: (() => { try { window.__dmGM.getValue('token-falso', 'x'); return 'aceitou'; } catch (e) { return 'recusou'; } })(),
    })`);
    console.log('injetados:', JSON.stringify(injetados));
    console.log('resultado:', JSON.stringify(resultado));

    servidor.close();
    if (!injetados || !injetados.includes('GM teste')) return fail('script não injetado');
    if (resultado.valor !== 'valor-gm') return fail(`GM_getValue devolveu ${resultado.valor}`);
    if (resultado.http !== '200:eco-ok') return fail(`GM_xmlhttpRequest devolveu ${resultado.http}`);
    if (resultado.semToken !== 'recusou') return fail('chamada sem token não foi recusada');

    console.log('OK: API GM_* funcionou na página, com token e @grant');
    app.exit(0);
  } catch (err) {
    fail(err.stack || err.message);
  }
});
