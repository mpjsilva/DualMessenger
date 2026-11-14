'use strict';

// Transcrição de áudio local: converte o áudio com ffmpeg (WAV mono 16 kHz), corta em trechos
// de 15 segundos e transcreve cada trecho com whisper.cpp (whisper-cli). Nada sai do computador.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Tamanho do trecho: a cada trecho pronto, o texto aparece na tela (transcrição em tempo real).
const SEGUNDOS_POR_TRECHO = 15;
const TAXA = 16000;          // Hz
const BYTES_POR_SEGUNDO = TAXA * 2; // 16 bits mono

// limite: só os primeiros N segundos (prévia de vídeo).
function buildFfmpegArgs(input, output, limite = null) {
  const corte = limite ? ['-t', String(limite)] : [];
  return ['-y', '-loglevel', 'error', '-i', input, '-vn', ...corte, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output];
}

function buildWhisperArgs({ model, wav, outPrefix, language = 'pt', threads = 4 }) {
  return [
    '-m', model,
    '-f', wav,
    '-l', language,
    '-t', String(threads),
    '-nt',          // sem timestamps no texto
    '-oj',          // saída em JSON
    '-of', outPrefix,
  ];
}

// Lê o JSON gerado pelo whisper-cli e devolve só o texto e o idioma detectado.
function parseWhisperJson(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const segmentos = Array.isArray(data.transcription) ? data.transcription : [];
  const texto = segmentos.map((s) => String(s.text || '').trim()).filter(Boolean).join(' ').trim();
  return {
    texto,
    idioma: data.result && data.result.language ? data.result.language : null,
  };
}

// Cabeçalho WAV (PCM, mono, 16 kHz, 16 bits) para um bloco de amostras.
function cabecalhoWav(dados) {
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0, 'ascii');
  cab.writeUInt32LE(36 + dados.length, 4);
  cab.write('WAVE', 8, 'ascii');
  cab.write('fmt ', 12, 'ascii');
  cab.writeUInt32LE(16, 16);            // tamanho do bloco fmt
  cab.writeUInt16LE(1, 20);             // PCM
  cab.writeUInt16LE(1, 22);             // mono
  cab.writeUInt32LE(TAXA, 24);          // taxa de amostragem
  cab.writeUInt32LE(BYTES_POR_SEGUNDO, 28);
  cab.writeUInt16LE(2, 32);             // bytes por quadro
  cab.writeUInt16LE(16, 34);            // bits por amostra
  cab.write('data', 36, 'ascii');
  cab.writeUInt32LE(dados.length, 40);
  return Buffer.concat([cab, dados]);
}

// Divide um WAV 16 kHz mono de 16 bits em trechos de `segundos`, cada um com cabeçalho próprio.
// Um pedaço final de menos de 7,5 s vai junto com o anterior: cada passagem do modelo custa o mesmo
// (ele completa uma janela de 30 s), então um pedaço curto custaria uma passagem inteira à toa.
// Se o arquivo não estiver nesse formato, devolve null e o áudio segue inteiro.
function dividirWav(buffer, segundos = SEGUNDOS_POR_TRECHO) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let formatoOk = false;
  let dados = null;
  let pos = 12;
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString('ascii', pos, pos + 4);
    const tamanho = buffer.readUInt32LE(pos + 4);
    const corpo = pos + 8;
    if (id === 'fmt ') {
      formatoOk = buffer.readUInt16LE(corpo) === 1 && buffer.readUInt16LE(corpo + 2) === 1
        && buffer.readUInt32LE(corpo + 4) === TAXA && buffer.readUInt16LE(corpo + 14) === 16;
    } else if (id === 'data') {
      dados = buffer.subarray(corpo, Math.min(corpo + tamanho, buffer.length));
      break;
    }
    pos = corpo + tamanho + (tamanho % 2);
  }
  if (!formatoOk || !dados || dados.length === 0) return null;

  const porTrecho = segundos * BYTES_POR_SEGUNDO;
  const blocos = [];
  for (let i = 0; i < dados.length; i += porTrecho) {
    blocos.push(dados.subarray(i, Math.min(i + porTrecho, dados.length)));
  }
  if (blocos.length > 1 && blocos[blocos.length - 1].length < 7.5 * BYTES_POR_SEGUNDO) {
    const fim = blocos.pop();
    blocos[blocos.length - 1] = Buffer.concat([blocos[blocos.length - 1], fim]);
  }
  return blocos.map(cabecalhoWav);
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let erro = '';
    proc.stderr.on('data', (d) => { erro += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      // 0xC0000135 (3221225781): uma DLL necessária não foi encontrada (no Windows, quase sempre o Visual C++).
      if (code === 3221225781) reject(new Error('faltam componentes do Windows (Visual C++). Abra Opções › Transcrição e toque em Preparar de novo'));
      else reject(new Error(`${path.basename(bin)} saiu com código ${code}: ${erro.trim().slice(-300)}`));
    });
  });
}

// Caminho com pasta (ex.: /usr/bin/ffmpeg) é conferido aqui; nome solto (ex.: ffmpeg) vem do PATH.
function caminhoConferido(valor) {
  return !valor.includes(path.sep) || fs.existsSync(valor);
}

// config: { ffmpeg, whisper, model, language?, threads? }
// opcoes.onParcial(texto): chamado a cada trecho que termina, com o texto até ali (só para exibir).
// O texto final é a soma dos trechos. Erro nesse callback não derruba a transcrição.
// Entrada .wav já tem que estar em 16 kHz mono (é o que o whisper.cpp usa); os demais formatos passam pelo ffmpeg.
async function transcreverArquivo(inputPath, config, opcoes = {}) {
  const ehWav = path.extname(inputPath).toLowerCase() === '.wav';
  const exigidos = [['whisper', config.whisper], ['model', config.model]];
  if (!ehWav) exigidos.push(['ffmpeg', config.ffmpeg]);
  for (const [nome, valor] of exigidos) {
    if (!valor || !caminhoConferido(valor)) {
      throw new Error(`transcrição não está pronta (${nome} não encontrado). Abra Opções › Transcrição e toque em Preparar.`);
    }
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-transcricao-'));
  try {
    const wav = path.join(tmp, 'audio.wav');
    if (ehWav) fs.copyFileSync(inputPath, wav);
    else {
      try {
        await run(config.ffmpeg, buildFfmpegArgs(inputPath, wav, opcoes.limiteSegundos));
      } catch (err) {
        // Vídeo sem faixa de áudio (ex.: GIF do WhatsApp): o ffmpeg não gera o WAV.
        if (/does not contain any stream|matches no streams|Output file #0 does not contain/i.test(err.message)) throw new Error('este vídeo não tem áudio');
        throw err;
      }
    }

    const bruto = fs.readFileSync(wav);
    const trechos = dividirWav(bruto) || [bruto];
    const partes = [];
    let idioma = null;
    for (const [i, trecho] of trechos.entries()) {
      const arquivo = path.join(tmp, `trecho${i}.wav`);
      const outPrefix = path.join(tmp, `saida${i}`);
      fs.writeFileSync(arquivo, trecho);
      await run(config.whisper, buildWhisperArgs({
        model: config.model,
        wav: arquivo,
        outPrefix,
        language: config.language || 'pt',
        threads: config.threads || 4,
      }));
      const r = parseWhisperJson(fs.readFileSync(`${outPrefix}.json`, 'utf8'));
      if (r.texto) partes.push(r.texto);
      if (!idioma) idioma = r.idioma;
      if (opcoes.onParcial) {
        try {
          opcoes.onParcial(partes.join(' '));
        } catch {
          // a página pode ter fechado ou navegado: a transcrição segue até o fim
        }
      }
    }
    return { texto: partes.join(' '), idioma };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { buildFfmpegArgs, buildWhisperArgs, parseWhisperJson, cabecalhoWav, dividirWav, transcreverArquivo };
