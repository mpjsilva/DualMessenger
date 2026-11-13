'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { criarAtualizador } = require('../src/atualizador');

function montar({ resposta = 0 } = {}) {
  const au = new EventEmitter();
  au.chamadas = [];
  au.checkForUpdates = async () => { au.chamadas.push('check'); };
  au.downloadUpdate = async () => { au.chamadas.push('download'); au.emit('update-downloaded'); };
  au.quitAndInstall = (silencioso, reabrir) => au.chamadas.push(`instalar:${silencioso}:${reabrir}`);
  const caixas = [];
  const dialog = { showMessageBox: async (...a) => { caixas.push(a[a.length - 1]); return { response: resposta }; } };
  let saiu = 0;
  const atual = criarAtualizador({ autoUpdater: au, dialog, janela: () => null, antesDeSair: () => { saiu++; } });
  return { au, caixas, atual, saiu: () => saiu };
}

test('versão nova: pergunta, baixa, e instala reabrindo o app', async () => {
  const { au, caixas, atual, saiu } = montar();
  await atual.verificar();
  au.emit('update-available', { version: '0.2.0' });
  await new Promise((r) => setImmediate(r));
  assert.match(caixas[0].message, /0\.2\.0/);
  assert.match(caixas[0].detail, /atualizar/);
  assert.deepEqual(au.chamadas, ['check', 'download', 'instalar:false:true']);
  assert.equal(saiu(), 1);
});

test('"Depois" não baixa e não pergunta de novo a mesma versão', async () => {
  const { au, caixas } = montar({ resposta: 1 });
  au.emit('update-available', { version: '0.2.0' });
  await new Promise((r) => setImmediate(r));
  au.emit('update-available', { version: '0.2.0' });
  await new Promise((r) => setImmediate(r));
  assert.equal(caixas.length, 1);
  assert.deepEqual(au.chamadas, []);
});

test('verificação manual sem novidade avisa que já está atualizado; a automática fica quieta', async () => {
  const { au, caixas, atual } = montar();
  au.emit('update-not-available');
  await new Promise((r) => setImmediate(r));
  assert.equal(caixas.length, 0);
  await atual.verificar({ pedido: true });
  au.emit('update-not-available');
  await new Promise((r) => setImmediate(r));
  assert.match(caixas[0].message, /mais recente/);
});
