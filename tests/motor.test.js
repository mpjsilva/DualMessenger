'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { ScriptManager, envolver } = require('../src/motor');
const { pastaTemp } = require('./ajuda');

const SCRIPT = (nome, match, extra = '') => `// ==UserScript==
// @name ${nome}
// @version 1.0
// @match ${match}
${extra}// ==/UserScript==
window.__marcas = (window.__marcas || []).concat(${JSON.stringify(nome)});
`;

function fakeWc(url) {
  const chamadas = [];
  return {
    chamadas,
    getURL: () => url,
    executeJavaScript: async (codigo) => {
      chamadas.push(codigo);
      // Executa de verdade num contexto isolado, como a página faria.
      const ctx = { window: {}, console };
      vm.createContext(ctx);
      vm.runInContext(codigo, ctx);
      return ctx.window.__marcas;
    },
  };
}

test('add valida o cabeçalho e guarda uma cópia', () => {
  const dir = pastaTemp('dm-motor-');
  const m = new ScriptManager({ dataDir: dir });
  const id = m.add(SCRIPT('Um', 'https://web.whatsapp.com/*'));
  assert.equal(m.list()[0].name, 'Um');
  assert.ok(fs.existsSync(path.join(dir, 'userscripts', `${id}.user.js`)));
  assert.throws(() => m.add(SCRIPT('Um', 'https://web.whatsapp.com/*')), /já está instalado/);
  assert.throws(() => m.add('console.log(1)'), /sem bloco/);
});

test('injetar roda só os scripts que combinam com a URL e habilitados', async () => {
  const dir = pastaTemp('dm-motor-');
  const m = new ScriptManager({ dataDir: dir });
  m.add(SCRIPT('WA', 'https://web.whatsapp.com/*'));
  m.add(SCRIPT('TG', '*://*.telegram.org/*'));
  const desligado = m.add(SCRIPT('Desligado', 'https://web.whatsapp.com/*'));
  m.setEnabled(desligado, false);

  const wc = fakeWc('https://web.whatsapp.com/');
  const injetados = await m.injetar(wc);
  assert.deepEqual(injetados, ['WA']);
  assert.equal(wc.chamadas.length, 1);
});

test('erro em um script não impede os outros', async () => {
  const dir = pastaTemp('dm-motor-');
  const m = new ScriptManager({ dataDir: dir });
  m.add(SCRIPT('Quebrado', 'https://web.whatsapp.com/*').replace('window.__marcas', 'naoExiste.x'));
  m.add(SCRIPT('Bom', 'https://web.whatsapp.com/*'));
  const wc = fakeWc('https://web.whatsapp.com/');
  // O envolvimento captura o erro dentro do script: os dois são injetados.
  const injetados = await m.injetar(wc);
  assert.deepEqual(injetados, ['Quebrado', 'Bom']);
});

test('envolver isola o script com try/catch', () => {
  const codigo = envolver('throw new Error("x");', 'Teste');
  assert.match(codigo, /try \{/);
  assert.match(codigo, /userscript/);
  assert.doesNotThrow(() => vm.runInNewContext(codigo, { console: { error() {} } }));
});

test('remove apaga o arquivo do script', () => {
  const dir = pastaTemp('dm-motor-');
  const m = new ScriptManager({ dataDir: dir });
  const id = m.add(SCRIPT('Apagar', 'https://web.whatsapp.com/*'));
  const arquivo = path.join(dir, 'userscripts', `${id}.user.js`);
  m.remove(id);
  assert.equal(m.list().length, 0);
  assert.equal(fs.existsSync(arquivo), false);
});
