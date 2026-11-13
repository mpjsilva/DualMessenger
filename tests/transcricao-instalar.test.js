'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarInstalador, caminhos } = require('../src/transcricao-instalar');
const { pastaTemp } = require('./ajuda');

function pastas() {
  return {
    dataDir: pastaTemp('dm-inst-dados-'),
    appDir: pastaTemp('dm-inst-app-'),
  };
}

test('caminhos ficam dentro da pasta de dados do app', () => {
  const c = caminhos('/dados', '/app');
  assert.equal(c.whisperBin, path.join('/dados', 'whisper.cpp', 'build', 'bin', 'whisper-cli'));
  assert.equal(c.modelo, path.join('/dados', 'modelos', 'ggml-small.bin'));
  assert.equal(c.config, path.join('/dados', 'transcricao.json'));
  assert.equal(c.ffmpegDoProjeto, path.join('/app', 'vendor', 'bin', 'ffmpeg'));
});

test('sem nada instalado, o estado diz que não está pronto', () => {
  const { dataDir, appDir } = pastas();
  const e = criarInstalador({ dataDir, appDir }).estado();
  assert.equal(e.pronto, false);
  assert.equal(e.whisper, false);
  assert.equal(e.modelo, false);
});

test('whisper-cli e modelo presentes são reconhecidos', () => {
  const { dataDir, appDir } = pastas();
  const c = caminhos(dataDir, appDir);
  fs.mkdirSync(path.dirname(c.whisperBin), { recursive: true });
  fs.writeFileSync(c.whisperBin, '');
  fs.mkdirSync(path.dirname(c.modelo), { recursive: true });
  fs.writeFileSync(c.modelo, '');
  const e = criarInstalador({ dataDir, appDir }).estado();
  assert.equal(e.whisper, true);
  assert.equal(e.modelo, true);
});
