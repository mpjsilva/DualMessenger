'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { ScriptManager } = require('../src/motor');
const { pastaTemp } = require('./ajuda');

function novoMotor() {
  return new ScriptManager({ dataDir: pastaTemp('dm-gm-') });
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

test('script sem @grant recebe só unsafeWindow, GM_info e GM vazio (como no Tampermonkey)', () => {
  const m = novoMotor();
  const id = m.add(script('Sem grants', []));
  const shim = m.shim(m.items.find((i) => i.id === id));
  assert.match(shim, /var unsafeWindow = window/);
  assert.match(shim, /var GM_info = /);
  assert.doesNotMatch(shim, /function GM_/);
  assert.doesNotMatch(shim, /GM\.getValue =/);
});

test('GM.* (assíncrono) só existe para as funções concedidas, com o nome sem prefixo', () => {
  const m = novoMotor();
  const id = m.add(script('Async', ['GM.getValue', 'GM.setValue', 'GM_xmlhttpRequest']));
  const item = m.items.find((i) => i.id === id);
  assert.deepEqual(item.meta.grant, ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest']);
  const shim = m.shim(item);
  assert.match(shim, /GM\.getValue = function/);
  assert.match(shim, /GM\.xmlHttpRequest = function/);
  assert.doesNotMatch(shim, /GM\.deleteValue =/);
});

test('GM_info traz os metadados do cabeçalho', () => {
  const m = novoMotor();
  const texto = `// ==UserScript==
// @name Info
// @version 2.3
// @author Alguém
// @namespace http://exemplo.test/
// @description Teste
// @match https://web.whatsapp.com/*
// @grant none
// ==/UserScript==
`;
  const id = m.add(texto);
  const shim = m.shim(m.items.find((i) => i.id === id));
  const json = shim.match(/var GM_info = (.*);/)[1];
  const info = JSON.parse(json);
  assert.equal(info.script.name, 'Info');
  assert.equal(info.script.version, '2.3');
  assert.equal(info.script.author, 'Alguém');
  assert.equal(info.script.description, 'Teste');
  assert.deepEqual(info.script.grants, ['none']);
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

function scriptComRequire(url, extra = '') {
  return `// ==UserScript==
// @name Com require
// @match https://web.whatsapp.com/*
// @require ${url}
${extra}// @grant none
// ==/UserScript==
window.__ok = true;
`;
}

test('domínios: aceita host ou *.host, recusa nome sem ponto e casa subdomínios', () => {
  const m = novoMotor();
  assert.equal(m.adicionarDominio('https://CDN.jsDelivr.net/npm/x'), 'cdn.jsdelivr.net');
  assert.equal(m.adicionarDominio('*.unpkg.com'), 'unpkg.com');
  assert.throws(() => m.adicionarDominio('localhost'), /domínio inválido/);
  assert.equal(m.dominioPermitido('https://cdn.jsdelivr.net/a.js'), true);
  assert.equal(m.dominioPermitido('https://a.b.unpkg.com/x.js'), true);
  assert.equal(m.dominioPermitido('https://evil-cdn.jsdelivr.net.attacker.com/x.js'), false);
  assert.equal(m.dominioPermitido('https://outro.com/x.js'), false);
  m.removerDominio('unpkg.com');
  assert.deepEqual(m.listarDominios(), ['cdn.jsdelivr.net']);
});

test('@require de domínio não cadastrado é recusado e o script fica com erro', async () => {
  const m = novoMotor();
  m.add(scriptComRequire('https://outro.com/lib.js'));
  let executado = false;
  const wc = {
    id: 7,
    getURL: () => 'https://web.whatsapp.com/',
    executeJavaScript: async () => { executado = true; },
  };
  const injetados = await m.injetar(wc);
  assert.deepEqual(injetados, []);
  assert.equal(executado, false);
  assert.match(m.list()[0].erro, /domínio não permitido: outro\.com/);
});

test('@require de domínio cadastrado é baixado e entra no script (com cache)', async () => {
  const servidor = http.createServer((req, res) => {
    res.end('window.__lib = 42;');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    const m = novoMotor();
    m.adicionarDominio('127.0.0.1');
    const url = `http://127.0.0.1:${servidor.address().port}/lib.js`;
    const id = m.add(scriptComRequire(url));
    const item = m.items.find((i) => i.id === id);
    const recursos = await m.montarRecursos(item);
    assert.match(recursos.requires, /window\.__lib = 42/);
    assert.match(m.shim(item, recursos), /window\.__lib = 42/);
    // Segunda vez: vem do cache mesmo com o servidor fechado.
    await new Promise((r) => servidor.close(r));
    const de_novo = await m.montarRecursos(item);
    assert.match(de_novo.requires, /window\.__lib = 42/);
  } finally {
    if (servidor.listening) servidor.close();
  }
});

test('@connect restringe GM_xmlhttpRequest aos hosts declarados', async () => {
  const m = novoMotor();
  const id = m.add(`// ==UserScript==
// @name Conecta
// @match https://web.whatsapp.com/*
// @grant GM_xmlhttpRequest
// @connect exemplo.com
// ==/UserScript==
`);
  const t = m.tokenFor(id);
  await assert.rejects(m.xhr(t, { url: 'https://outro.com/x' }), /não declarou @connect para outro\.com/);
});

test('menus de GM_registerMenuCommand são por aba e podem ser removidos', () => {
  const m = novoMotor();
  const id = m.add(script('Menu', ['GM_registerMenuCommand', 'GM_unregisterMenuCommand']));
  const t = m.tokenFor(id);
  const a = m.registrarMenu(t, 'Limpar histórico', 1);
  const b = m.registrarMenu(t, 'Outro', 2);
  assert.notEqual(a, b);
  assert.deepEqual(m.comandosDaAba(1), [{ id: a, nome: 'Limpar histórico', script: 'Menu' }]);
  m.removerMenu(t, a, 1);
  assert.deepEqual(m.comandosDaAba(1), []);
  assert.equal(m.comandosDaAba(2).length, 1);
});

test('GM_openInTab aceita só http(s) e devolve a URL normalizada', () => {
  const m = novoMotor();
  const id = m.add(script('Abrir', ['GM_openInTab']));
  assert.equal(m.abrirUrl(m.tokenFor(id), 'https://exemplo.com/a b'), 'https://exemplo.com/a%20b');
  assert.throws(() => m.abrirUrl(m.tokenFor(id), 'file:///etc/passwd'), /só http e https/);
});
