'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { criarServicoTranscricao } = require('../src/transcricao-servico');

// O cache é por conteúdo do áudio: o mesmo áudio com outro id (outra conversa do Telegram)
// reaproveita a transcrição, e o id sozinho não entrega texto de outro áudio.
test('mesmo áudio com outro id usa o cache (chave pelo conteúdo)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-servico-cache-'));
  const bytes = Buffer.from('audio de teste');
  const chave = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(dataDir, 'transcricoes.json'), JSON.stringify({ [chave]: { texto: 'olá', idioma: 'pt' } }));

  const servico = criarServicoTranscricao({ dataDir, appDir: dataDir });
  const r = await servico.transcrever({ id: 'conversa-b-42', bytes, ext: 'ogg' });
  assert.deepEqual(r, { texto: 'olá', idioma: 'pt', emCache: true });
});

test('id de mensagem inválido é recusado antes de qualquer trabalho', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-servico-id-'));
  const servico = criarServicoTranscricao({ dataDir, appDir: dataDir });
  await assert.rejects(servico.transcrever({ id: '', bytes: Buffer.from('x'), ext: 'ogg' }), /mensagem inválida/);
});
