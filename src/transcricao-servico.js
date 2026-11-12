'use strict';

// Serviço de transcrição sob demanda: recebe o áudio de uma mensagem de voz (WhatsApp ou Telegram),
// transcreve tudo localmente e guarda o resultado (uma vez por áudio).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { transcreverArquivo } = require('./transcricao');
const { resolverConfigTranscricao } = require('./transcricao-config');
const { readJson, writeJsonAtomic } = require('./store');

const EXTENSOES = new Set(['ogg', 'opus', 'mp4', 'm4a', 'webm', 'mp3', 'wav']);
const TAMANHO_MAX = 25 * 1024 * 1024;

function criarServicoTranscricao({ dataDir, appDir }) {
  const cachePath = path.join(dataDir, 'transcricoes.json');
  let fila = Promise.resolve(); // uma transcrição por vez: o whisper usa a CPU inteira

  async function executar({ bytes, ext, onParcial }) {
    // Pasta temporária só para esta transcrição: o áudio é gravado aqui e apagado no fim (finally).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-transcrever-'));
    try {
      const entrada = path.join(tmp, `audio.${ext}`);
      fs.writeFileSync(entrada, Buffer.from(bytes));
      const config = resolverConfigTranscricao({ dataDir, appDir });
      const r = await transcreverArquivo(entrada, config, { onParcial });
      return { texto: r.texto, idioma: r.idioma };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // opcoes.onParcial(texto): texto até o trecho atual (ver transcreverArquivo). Com cache, não há parciais.
  async function transcrever({ id, bytes, ext }, opcoes = {}) {
    if (typeof id !== 'string' || id.length < 1 || id.length > 300) throw new Error('mensagem inválida');
    if (!EXTENSOES.has(ext)) throw new Error('formato de áudio não suportado');
    if (!bytes || !bytes.byteLength) throw new Error('áudio vazio');
    if (bytes.byteLength > TAMANHO_MAX) throw new Error('áudio grande demais (limite de 25 MB)');

    // A chave é o conteúdo do áudio, não o id: o id de uma mensagem do Telegram só é único dentro da conversa.
    const chave = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    const salvo = readJson(cachePath, {});
    if (salvo[chave]) return { ...salvo[chave], emCache: true };

    const tarefa = fila.then(() => executar({ bytes, ext, onParcial: opcoes.onParcial }));
    fila = tarefa.catch(() => {});
    const resultado = await tarefa;

    const atual = readJson(cachePath, {});
    atual[chave] = resultado;
    writeJsonAtomic(cachePath, atual);
    return { ...resultado, emCache: false };
  }

  return { transcrever };
}

module.exports = { criarServicoTranscricao, EXTENSOES, TAMANHO_MAX };
