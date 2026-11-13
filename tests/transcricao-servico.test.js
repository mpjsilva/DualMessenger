'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { criarServicoTranscricao } = require('../src/transcricao-servico');
const { pastaTemp } = require('./ajuda');

// O cache é por conteúdo do áudio: o mesmo áudio com outro id (outra conversa do Telegram)
// reaproveita a transcrição, e o id sozinho não entrega texto de outro áudio.
test('mesmo áudio com outro id usa o cache (chave pelo conteúdo)', async () => {
  const dataDir = pastaTemp('dm-servico-cache-');
  const bytes = Buffer.from('audio de teste');
  const chave = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(dataDir, 'transcricoes.json'), JSON.stringify({ [chave]: { texto: 'olá', idioma: 'pt' } }));

  const servico = criarServicoTranscricao({ dataDir, appDir: dataDir });
  const r = await servico.transcrever({ id: 'conversa-b-42', bytes, ext: 'ogg' });
  assert.deepEqual(r, { texto: 'olá', idioma: 'pt', emCache: true });
});

test('id de mensagem inválido é recusado antes de qualquer trabalho', async () => {
  const dataDir = pastaTemp('dm-servico-id-');
  const servico = criarServicoTranscricao({ dataDir, appDir: dataDir });
  await assert.rejects(servico.transcrever({ id: '', bytes: Buffer.from('x'), ext: 'ogg' }), /mensagem inválida/);
});

test('vídeo: extensões de vídeo são aceitas e o limite é maior que o do áudio', async () => {
  const { EXTENSOES, TAMANHO_MAX, TAMANHO_MAX_VIDEO } = require('../src/transcricao-servico');
  for (const ext of ['mp4', 'webm', 'mov', '3gp', 'mkv']) assert.ok(EXTENSOES.has(ext), ext);
  assert.ok(TAMANHO_MAX_VIDEO > TAMANHO_MAX);
  const dataDir = pastaTemp('dm-servico-video-');
  const servico = criarServicoTranscricao({ dataDir, appDir: dataDir });
  // Áudio de 26 MB passa do limite do áudio; o mesmo tamanho como vídeo não é barrado pelo tamanho.
  const grande = Buffer.alloc(26 * 1024 * 1024);
  await assert.rejects(servico.transcrever({ id: 'a', bytes: grande, ext: 'ogg' }), /áudio grande demais/);
  await assert.rejects(servico.transcrever({ id: 'v', bytes: grande, ext: 'mp4', video: true }), (e) => !/grande demais/.test(e.message));
});
