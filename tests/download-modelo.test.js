'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { baixarModelo } = require('../src/transcricao-instalar');
const { pastaTemp } = require('./ajuda');

// Servidor local que anuncia o tamanho certo (como o Hugging Face faz).
function servidor(tamanho) {
  const corpo = Buffer.alloc(tamanho, 7);
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { 'content-length': String(corpo.length), 'content-type': 'application/octet-stream' });
      res.end(corpo);
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}/modelo.bin` }));
  });
}

test('download completo é aceito e recebe o nome final', async () => {
  const { s, url } = await servidor(3 * 1024 * 1024);
  const destino = path.join(pastaTemp('dm-dl-'), 'ggml-small.bin');
  try {
    await baixarModelo(destino, () => {}, url);
    assert.equal(fs.statSync(destino).size, 3 * 1024 * 1024);
    assert.equal(fs.existsSync(`${destino}.parcial`), false);
  } finally {
    s.close();
  }
});

test('download com tamanho menor que o anunciado é recusado', async () => {
  // Servidor que promete 3 MB mas corta a resposta no meio.
  const s = http.createServer((req, res) => {
    res.writeHead(200, { 'content-length': String(3 * 1024 * 1024) });
    res.write(Buffer.alloc(1024 * 1024, 1));
    setTimeout(() => res.destroy(), 20);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const destino = path.join(pastaTemp('dm-dl-'), 'ggml-small.bin');
  try {
    await assert.rejects(baixarModelo(destino, () => {}, `http://127.0.0.1:${s.address().port}/x`));
    assert.equal(fs.existsSync(destino), false);
  } finally {
    s.close();
  }
});
