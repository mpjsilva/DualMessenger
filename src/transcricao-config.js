'use strict';

// Onde estão o ffmpeg, o whisper-cli e o modelo. Valores em transcricao.json (pasta de dados
// do app) têm prioridade; sem eles, usa o ffmpeg que vem no projeto e o whisper-cli do PATH.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { readJson } = require('./store');

const MODELO_PADRAO = 'ggml-small.bin';

function resolverConfigTranscricao({ dataDir, appDir, existe = fs.existsSync }) {
  const salva = readJson(path.join(dataDir, 'transcricao.json'), {});
  const ffmpegDoProjeto = path.join(appDir, 'vendor', 'bin', 'ffmpeg');
  return {
    ffmpeg: salva.ffmpeg || (existe(ffmpegDoProjeto) ? ffmpegDoProjeto : 'ffmpeg'),
    whisper: salva.whisper || 'whisper-cli',
    model: salva.model || path.join(dataDir, 'modelos', MODELO_PADRAO),
    language: salva.language || 'pt',
    threads: salva.threads || Math.max(1, Math.min(8, os.cpus().length - 1)),
  };
}

module.exports = { resolverConfigTranscricao, MODELO_PADRAO };
