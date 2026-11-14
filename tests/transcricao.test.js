'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildFfmpegArgs, buildWhisperArgs, parseWhisperJson, cabecalhoWav, dividirWav, transcreverArquivo } = require('../src/transcricao');
const { pastaTemp } = require('./ajuda');

// WAV de teste: 16 kHz, mono, 16 bits, com `segundos` de silêncio.
const wavDeTeste = (segundos) => cabecalhoWav(Buffer.alloc(Math.round(segundos * 32000)));

test('buildFfmpegArgs converte para WAV mono 16 kHz', () => {
  const args = buildFfmpegArgs('/a/entrada.ogg', '/t/saida.wav');
  assert.ok(args.includes('-ar') && args[args.indexOf('-ar') + 1] === '16000');
  assert.ok(args.includes('-ac') && args[args.indexOf('-ac') + 1] === '1');
  assert.equal(args.at(-1), '/t/saida.wav');
  assert.equal(args[args.indexOf('-i') + 1], '/a/entrada.ogg');
});

test('buildWhisperArgs usa português por padrão e gera JSON', () => {
  const args = buildWhisperArgs({ model: '/m.bin', wav: '/t/a.wav', outPrefix: '/t/saida' });
  assert.equal(args[args.indexOf('-l') + 1], 'pt');
  assert.ok(args.includes('-oj'));
  assert.equal(args[args.indexOf('-of') + 1], '/t/saida');
  assert.equal(args[args.indexOf('-m') + 1], '/m.bin');
});

test('parseWhisperJson junta os segmentos e devolve o idioma', () => {
  const json = {
    result: { language: 'pt' },
    transcription: [
      { text: ' Por isso que vir e mexe, ' },
      { text: 'eu abro os consórnios um pouquinho.' },
    ],
  };
  const r = parseWhisperJson(JSON.stringify(json));
  assert.equal(r.idioma, 'pt');
  assert.equal(r.texto, 'Por isso que vir e mexe, eu abro os consórnios um pouquinho.');
});

test('parseWhisperJson lida com áudio sem fala', () => {
  const r = parseWhisperJson({ result: { language: 'pt' }, transcription: [] });
  assert.equal(r.texto, '');
});

test('dividirWav corta em trechos de 15 s, cada um um WAV válido', () => {
  const trechos = dividirWav(wavDeTeste(40), 15);
  assert.equal(trechos.length, 3); // 15 + 15 + 10
  assert.equal(trechos[0].length, 44 + 15 * 32000);
  assert.equal(trechos[2].length, 44 + 10 * 32000);
  assert.equal(trechos[2].toString('ascii', 0, 4), 'RIFF');
  assert.equal(trechos[2].readUInt32LE(40), 10 * 32000);
});

test('dividirWav junta um pedaço final de menos de 7,5 s ao trecho anterior (15 + 5 vira 20 s)', () => {
  const trechos = dividirWav(wavDeTeste(20), 15);
  assert.equal(trechos.length, 1);
  assert.equal(trechos[0].readUInt32LE(40), 20 * 32000);
});

test('dividirWav mantém um pedaço final de 7,5 s ou mais (15 + 10 continua 2 trechos)', () => {
  const trechos = dividirWav(wavDeTeste(25), 15);
  assert.equal(trechos.length, 2);
  assert.equal(trechos[1].readUInt32LE(40), 10 * 32000);
});

test('dividirWav devolve null para formato diferente de 16 kHz mono 16 bits', () => {
  const wav = wavDeTeste(2);
  wav.writeUInt32LE(8000, 24); // taxa de 8 kHz
  assert.equal(dividirWav(wav), null);
});

// whisper-cli falso: grava um JSON com o nome do arquivo recebido (-f), para conferir a ordem dos trechos.
function preparar40s() {
  const pasta = pastaTemp('dm-teste-trechos-');
  const falso = path.join(pasta, 'whisper-falso');
  fs.writeFileSync(falso, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const a = process.argv.slice(2);
const entrada = a[a.indexOf('-f') + 1];
const saida = a[a.indexOf('-of') + 1];
fs.writeFileSync(saida + '.json', JSON.stringify({ result: { language: 'pt' }, transcription: [{ text: ' ' + path.basename(entrada) }] }));
`);
  fs.chmodSync(falso, 0o755);
  const modelo = path.join(pasta, 'modelo.bin');
  fs.writeFileSync(modelo, 'x');
  const entrada = path.join(pasta, 'audio.wav');
  fs.writeFileSync(entrada, wavDeTeste(40));
  return { entrada, config: { whisper: falso, model: modelo } };
}

test('transcreverArquivo entrega o texto parcial a cada trecho, em ordem', async () => {
  const { entrada, config } = preparar40s();
  const parciais = [];
  const r = await transcreverArquivo(entrada, config, { onParcial: (t) => parciais.push(t) });
  assert.deepEqual(parciais, ['trecho0.wav', 'trecho0.wav trecho1.wav', 'trecho0.wav trecho1.wav trecho2.wav']);
  assert.equal(r.texto, 'trecho0.wav trecho1.wav trecho2.wav');
  assert.equal(r.idioma, 'pt');
});

test('erro no onParcial não interrompe a transcrição', async () => {
  const { entrada, config } = preparar40s();
  const r = await transcreverArquivo(entrada, config, { onParcial: () => { throw new Error('página fechada'); } });
  assert.equal(r.texto, 'trecho0.wav trecho1.wav trecho2.wav');
});

test('ffmpeg ignora a faixa de vídeo (-vn) e extrai só o áudio', () => {
  const args = buildFfmpegArgs('video.mp4', 'audio.wav');
  assert.ok(args.includes('-vn'));
  assert.equal(args.indexOf('-vn') > args.indexOf('-i'), true);
});

test('ffmpeg: o limite corta o áudio nos primeiros N segundos (prévia de vídeo)', () => {
  const com = buildFfmpegArgs('v.mp4', 'a.wav', 60);
  assert.deepEqual(com.slice(com.indexOf('-t'), com.indexOf('-t') + 2), ['-t', '60']);
  assert.equal(buildFfmpegArgs('v.mp4', 'a.wav').includes('-t'), false);
});
