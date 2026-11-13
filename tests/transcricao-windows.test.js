'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { caminhos, baixarVerificado, criarInstalador, FONTES_WINDOWS } = require('../src/transcricao-instalar');

function pastaTemp(nome) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-${nome}-`));
}

test('no Windows, o whisper-cli.exe e o ffmpeg.exe ficam em ferramentas/', () => {
  const c = caminhos('C:\\dados', 'C:\\app', 'win32');
  assert.equal(c.whisperBin, path.join('C:\\dados', 'ferramentas', 'whisper', 'whisper-cli.exe'));
  assert.equal(c.ffmpegDoProjeto, path.join('C:\\dados', 'ferramentas', 'ffmpeg', 'ffmpeg.exe'));
});

test('no Linux, os caminhos continuam os de antes (whisper compilado e ffmpeg do projeto)', () => {
  const c = caminhos('/dados', '/app', 'linux');
  assert.equal(c.whisperBin, path.join('/dados', 'whisper.cpp', 'build', 'bin', 'whisper-cli'));
  assert.equal(c.ffmpegDoProjeto, path.join('/app', 'vendor', 'bin', 'ffmpeg'));
});

test('no Windows não há pacotes do sistema para instalar', () => {
  const inst = criarInstalador({ dataDir: pastaTemp('win'), appDir: '/app', plataforma: 'win32' });
  assert.deepEqual(inst.ferramentasFaltando(), []);
});

test('as fontes do Windows são fixadas por SHA-256 de 64 caracteres', () => {
  for (const f of Object.values(FONTES_WINDOWS)) {
    assert.match(f.url, /^https:\/\/github\.com\/.+\.zip$/);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
});

test('baixarVerificado aceita o arquivo quando o SHA-256 confere', async () => {
  const conteudo = Buffer.from('arquivo de teste do whisper');
  const hash = crypto.createHash('sha256').update(conteudo).digest('hex');
  const servidor = http.createServer((req, res) => res.end(conteudo));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    const destino = path.join(pastaTemp('ok'), 'ferramenta.zip');
    await baixarVerificado(`http://127.0.0.1:${servidor.address().port}/x.zip`, destino, hash);
    assert.deepEqual(fs.readFileSync(destino), conteudo);
    assert.equal(fs.existsSync(`${destino}.parcial`), false);
  } finally {
    servidor.close();
  }
});

test('baixarVerificado recusa hash diferente e não deixa arquivo para trás', async () => {
  const servidor = http.createServer((req, res) => res.end('conteúdo adulterado'));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    const destino = path.join(pastaTemp('ruim'), 'ferramenta.zip');
    await assert.rejects(
      baixarVerificado(`http://127.0.0.1:${servidor.address().port}/x.zip`, destino, '0'.repeat(64)),
      /não confere \(SHA-256 diferente\)/,
    );
    assert.equal(fs.existsSync(destino), false);
    assert.equal(fs.existsSync(`${destino}.parcial`), false);
  } finally {
    servidor.close();
  }
});

test('vcRuntimeInstalado só vale quando as três DLLs do Visual C++ estão em System32', () => {
  const { vcRuntimeInstalado } = require('../src/transcricao-instalar');
  const sistema = pastaTemp('sistema');
  assert.equal(vcRuntimeInstalado(sistema), false);
  const sys32 = path.join(sistema, 'System32');
  fs.mkdirSync(sys32, { recursive: true });
  for (const dll of ['MSVCP140.dll', 'VCRUNTIME140.dll']) fs.writeFileSync(path.join(sys32, dll), '');
  assert.equal(vcRuntimeInstalado(sistema), false, 'falta VCRUNTIME140_1.dll');
  fs.writeFileSync(path.join(sys32, 'VCRUNTIME140_1.dll'), '');
  assert.equal(vcRuntimeInstalado(sistema), true);
});
