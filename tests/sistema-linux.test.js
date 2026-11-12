'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { integrarSistema, escaparArgumento, ID_APP } = require('../src/sistema-linux');
const { ARQUIVO_ICONE } = require('../src/recursos');

// Lê um argumento do Exec como o lançador: primeiro tira o escape do arquivo, depois o das aspas.
function lerArgumento(campo) {
  const doArquivo = campo.replace(/\\(.)/g, (_, c) => ({ s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' }[c] ?? `\\${c}`));
  const entreAspas = doArquivo.slice(1, -1);
  return entreAspas.replace(/\\(.)/g, '$1').replace(/%%/g, '%');
}

function casa() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sistema-home-'));
  return { home, dataHome: path.join(home, '.local', 'share') };
}

function linhaExec(arquivo) {
  return fs.readFileSync(arquivo, 'utf8').split('\n').find((l) => l.startsWith('Exec='));
}

test('o ícone do app é um PNG 512×512', () => {
  const bytes = fs.readFileSync(ARQUIVO_ICONE);
  assert.deepEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
  assert.equal(bytes.readUInt32BE(16), 512);
  assert.equal(bytes.readUInt32BE(20), 512);
});

test('escape do Exec: o caminho volta igual depois de lido pelo lançador', () => {
  const caminhos = [
    '/opt/Dual Messenger/electron',
    '/x/com "aspas"/app',
    '/x/$HOME/`crase`/app',
    '/x/100%/app',
    '/x/barra\\invertida/app',
    '/x/tudo "$`\\ %%/app',
  ];
  for (const c of caminhos) {
    assert.equal(lerArgumento(escaparArgumento(c)), c, c);
  }
});

test('escape do Exec: caminho comum fica entre aspas, sem caracteres extras', () => {
  assert.equal(escaparArgumento('/usr/bin/app'), '"/usr/bin/app"');
});

test('grava ícone e atalho com o nome do appId e o ícone por caminho absoluto', () => {
  const { home, dataHome } = casa();
  const gravou = integrarSistema({ icone: ARQUIVO_ICONE, comando: ['/opt/electron', '/srv/app'], home, dataHome });
  assert.equal(gravou, true);

  const atalho = path.join(dataHome, 'applications', `${ID_APP}.desktop`);
  const icone = path.join(dataHome, 'icons', `${ID_APP}.png`);
  assert.ok(fs.existsSync(atalho));
  assert.deepEqual(fs.readFileSync(icone), fs.readFileSync(ARQUIVO_ICONE));

  const conteudo = fs.readFileSync(atalho, 'utf8');
  assert.match(conteudo, /^\[Desktop Entry\]/);
  assert.match(conteudo, /^Name=Dual Messenger$/m);
  assert.match(conteudo, /^Type=Application$/m);
  assert.match(conteudo, /^StartupWMClass=local\.dualmessenger\.app$/m);
  assert.ok(conteudo.includes(`Icon=${icone}`));
  assert.equal(linhaExec(atalho), 'Exec="/opt/electron" "/srv/app"');
});

test('segunda execução não regrava nada; mudança no comando regrava', () => {
  const { home, dataHome } = casa();
  const args = { icone: ARQUIVO_ICONE, home, dataHome };
  assert.equal(integrarSistema({ ...args, comando: ['/opt/electron', '/srv/app'] }), true);
  assert.equal(integrarSistema({ ...args, comando: ['/opt/electron', '/srv/app'] }), false);

  // Mudou o caminho do AppImage (ou o do projeto): o atalho acompanha.
  assert.equal(integrarSistema({ ...args, comando: ['/home/x/Dual Messenger.AppImage'] }), true);
  const atalho = path.join(dataHome, 'applications', `${ID_APP}.desktop`);
  assert.equal(linhaExec(atalho), 'Exec="/home/x/Dual Messenger.AppImage"');
  assert.ok(!fs.existsSync(`${atalho}.tmp`));
});

test('XDG_DATA_HOME relativo é ignorado: usa ~/.local/share', () => {
  const { home } = casa();
  integrarSistema({ icone: ARQUIVO_ICONE, comando: ['/opt/electron'], home, dataHome: 'relativo/pasta' });
  assert.ok(fs.existsSync(path.join(home, '.local', 'share', 'applications', `${ID_APP}.desktop`)));
});
