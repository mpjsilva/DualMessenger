'use strict';

// Teste real da transcrição (não roda no `npm test`, precisa do whisper-cli e do modelo):
//   WHISPER_BIN=/caminho/whisper-cli MODELO=/caminho/ggml-small.bin AUDIO=/caminho/audio.wav node tests/smoke-transcricao.js
// O áudio tem que ser WAV 16 kHz mono (o pipeline não converte WAV).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarServicoTranscricao } = require('../src/transcricao-servico');
const { pastaTemp } = require('./ajuda');

async function main() {
  const { WHISPER_BIN, MODELO, AUDIO } = process.env;
  if (!WHISPER_BIN || !MODELO || !AUDIO) {
    console.error('Defina WHISPER_BIN, MODELO e AUDIO (veja o comentário no topo do arquivo).');
    process.exit(2);
  }
  const dados = pastaTemp('dm-smoke-tr-');
  fs.writeFileSync(path.join(dados, 'transcricao.json'), JSON.stringify({ whisper: WHISPER_BIN, model: MODELO }));

  const servico = criarServicoTranscricao({ dataDir: dados, appDir: path.join(__dirname, '..') });
  const bytes = fs.readFileSync(AUDIO);

  const inicio = Date.now();
  const primeira = await servico.transcrever({ id: 'msg-teste-1', bytes, ext: 'wav' }, {
    onParcial: (texto) => console.log(`  trecho pronto aos ${((Date.now() - inicio) / 1000).toFixed(1)} s: ${texto.length} caracteres`),
  });
  const tempo = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log('texto:', JSON.stringify(primeira.texto));
  console.log('idioma:', primeira.idioma, '| tempo:', tempo, 's | emCache:', primeira.emCache);
  if (!primeira.texto) throw new Error('transcrição vazia');

  const segunda = await servico.transcrever({ id: 'msg-teste-1', bytes, ext: 'wav' });
  if (!segunda.emCache || segunda.texto !== primeira.texto) throw new Error('o cache não devolveu o mesmo texto');
  console.log('OK: transcrição local e cache funcionaram');
}

main().catch((err) => {
  console.error('FALHOU:', err.message);
  process.exit(1);
});
