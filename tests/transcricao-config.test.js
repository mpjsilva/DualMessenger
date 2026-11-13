'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolverConfigTranscricao, MODELO_PADRAO } = require('../src/transcricao-config');
const { buildFfmpegArgs, buildWhisperArgs, parseWhisperJson } = require('../src/transcricao');
const { pastaTemp } = require('./ajuda');


test('sem transcricao.json: usa o ffmpeg do projeto e o whisper-cli do PATH', () => {
  const dados = pastaTemp('cfg-');
  const app = '/app';
  const cfg = resolverConfigTranscricao({ dataDir: dados, appDir: app, existe: (p) => p === path.join(app, 'vendor', 'bin', 'ffmpeg') });
  assert.equal(cfg.ffmpeg, path.join(app, 'vendor', 'bin', 'ffmpeg'));
  assert.equal(cfg.whisper, 'whisper-cli');
  assert.equal(cfg.model, path.join(dados, 'modelos', MODELO_PADRAO));
  assert.equal(cfg.language, 'pt');
  assert.ok(cfg.threads >= 1);
});

test('sem ffmpeg no projeto: cai para o ffmpeg do PATH', () => {
  const cfg = resolverConfigTranscricao({ dataDir: pastaTemp('cfg-'), appDir: '/app', existe: () => false });
  assert.equal(cfg.ffmpeg, 'ffmpeg');
});

test('transcricao.json na pasta de dados tem prioridade', () => {
  const dados = pastaTemp('cfg-');
  fs.writeFileSync(path.join(dados, 'transcricao.json'), JSON.stringify({
    whisper: '/opt/whisper/whisper-cli',
    model: '/opt/modelos/ggml-small.bin',
    threads: 2,
  }));
  const cfg = resolverConfigTranscricao({ dataDir: dados, appDir: '/app', existe: () => true });
  assert.equal(cfg.whisper, '/opt/whisper/whisper-cli');
  assert.equal(cfg.model, '/opt/modelos/ggml-small.bin');
  assert.equal(cfg.threads, 2);
});

test('argumentos do ffmpeg e do whisper', () => {
  assert.deepEqual(buildFfmpegArgs('a.ogg', 'b.wav').slice(-7), ['-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', 'b.wav']);
  const w = buildWhisperArgs({ model: 'm.bin', wav: 'a.wav', outPrefix: 'saida' });
  assert.deepEqual(w.slice(0, 4), ['-m', 'm.bin', '-f', 'a.wav']);
  assert.ok(w.includes('-oj'));
});

test('parseWhisperJson junta os segmentos', () => {
  const r = parseWhisperJson({ result: { language: 'pt' }, transcription: [{ text: ' Olá ' }, { text: 'mundo' }] });
  assert.deepEqual(r, { texto: 'Olá mundo', idioma: 'pt' });
});
