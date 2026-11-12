'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { ScriptManager } = require('../src/motor');

function novoMotor() {
  return new ScriptManager({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'dm-gm-')) });
}

function script(nome, grants) {
  return `// ==UserScript==
// @name ${nome}
// @version 1.0
// @match https://web.whatsapp.com/*
${grants.map((g) => `// @grant ${g}`).join('\n')}
// ==/UserScript==
console.log('${nome}');
`;
}

test('shim define só as funções concedidas pelo @grant', () => {
  const m = novoMotor();
  const id = m.add(script('Só leitura', ['GM_getValue']));
  const item = m.items.find((i) => i.id === id);
  const shim = m.shim(item);
  assert.match(shim, /function GM_getValue/);
  assert.doesNotMatch(shim, /function GM_setValue/);
  assert.doesNotMatch(shim, /function GM_xmlhttpRequest/);
});

test('script sem @grant (ou com none) não recebe API GM', () => {
  const m = novoMotor();
  const id = m.add(script('Sem grants', []));
  assert.equal(m.shim(m.items.find((i) => i.id === id)), '');
});

test('token é necessário e chamadas sem @grant são recusadas', () => {
  const m = novoMotor();
  const id = m.add(script('Leitura', ['GM_getValue']));
  const token = m.tokenFor(id);
  assert.equal(m.getValue(token, 'x', 'padrão'), 'padrão');
  assert.throws(() => m.setValue(token, 'x', 1), /não pede @grant GM_setValue/);
  assert.throws(() => m.getValue('token-falso', 'x'), /token válido/);
});

test('valores ficam separados por script e persistem no disco', () => {
  const m = novoMotor();
  const a = m.add(script('A', ['GM_getValue', 'GM_setValue']));
  const b = m.add(script('B', ['GM_getValue', 'GM_setValue']));
  m.setValue(m.tokenFor(a), 'nome', 'valor-A');
  m.setValue(m.tokenFor(b), 'nome', 'valor-B');
  assert.equal(m.getValue(m.tokenFor(a), 'nome'), 'valor-A');
  assert.equal(m.getValue(m.tokenFor(b), 'nome'), 'valor-B');

  // Reabre do disco: os valores continuam lá.
  const outro = new ScriptManager({ dataDir: path.dirname(m.dir) });
  assert.equal(outro.valores[a][`nome`], 'valor-A');
});

test('deleteValue e listValues funcionam', () => {
  const m = novoMotor();
  const id = m.add(script('C', ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues']));
  const t = m.tokenFor(id);
  m.setValue(t, 'k1', 1);
  m.setValue(t, 'k2', 2);
  m.deleteValue(t, 'k1');
  assert.deepEqual(m.listValues(t), ['k2']);
});

test('GM_xmlhttpRequest traz a resposta de um endereço local', async () => {
  const servidor = http.createServer((req, res) => {
    res.setHeader('x-teste', 'sim');
    res.end(`${req.method} ${req.url}`);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    const m = novoMotor();
    const id = m.add(script('HTTP', ['GM_xmlhttpRequest']));
    const port = servidor.address().port;
    const r = await m.xhr(m.tokenFor(id), { method: 'get', url: `http://127.0.0.1:${port}/caminho` });
    assert.equal(r.status, 200);
    assert.equal(r.responseText, 'GET /caminho');
    assert.match(r.responseHeaders, /x-teste: sim/);
  } finally {
    servidor.close();
  }
});

test('GM_xmlhttpRequest recusa esquemas que não são http(s)', async () => {
  const m = novoMotor();
  const id = m.add(script('HTTP', ['GM_xmlhttpRequest']));
  await assert.rejects(m.xhr(m.tokenFor(id), { url: 'file:///etc/passwd' }), /só http e https/);
});

test('shim não vaza o token em outro script', () => {
  const m = novoMotor();
  const a = m.add(script('A', ['GM_getValue']));
  const b = m.add(script('B', ['GM_getValue']));
  assert.notEqual(m.tokenFor(a), m.tokenFor(b));
  assert.match(m.shim(m.items.find((i) => i.id === a)), new RegExp(m.tokenFor(a)));
  assert.doesNotMatch(m.shim(m.items.find((i) => i.id === a)), new RegExp(m.tokenFor(b)));
});
