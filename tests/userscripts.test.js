'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHeader, urlMatches } = require('../src/userscripts');

const SCRIPT = `// ==UserScript==
// @name         Exemplo
// @namespace    local
// @version      1.2
// @match        https://web.whatsapp.com/*
// @match        *://*.telegram.org/*
// @exclude      https://web.telegram.org/k/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==
console.log('ok');
`;

test('parseHeader lê nome, versão, padrões, grants e run-at', () => {
  const meta = parseHeader(SCRIPT);
  assert.equal(meta.name, 'Exemplo');
  assert.equal(meta.version, '1.2');
  assert.deepEqual(meta.match, ['https://web.whatsapp.com/*', '*://*.telegram.org/*']);
  assert.deepEqual(meta.exclude, ['https://web.telegram.org/k/*']);
  assert.deepEqual(meta.grant, ['GM_getValue', 'GM_setValue']);
  assert.equal(meta.runAt, 'document-start');
});

test('parseHeader rejeita arquivo sem cabeçalho ou sem @name', () => {
  assert.throws(() => parseHeader('console.log(1)'), /sem bloco/);
  assert.throws(() => parseHeader('// ==UserScript==\n// @version 1\n// ==/UserScript=='), /sem @name/);
});

test('urlMatches casa @match e respeita @exclude', () => {
  const meta = parseHeader(SCRIPT);
  assert.equal(urlMatches(meta, 'https://web.whatsapp.com/'), true);
  assert.equal(urlMatches(meta, 'https://web.whatsapp.com/send?phone=1'), true);
  assert.equal(urlMatches(meta, 'https://web.telegram.org/a/'), true);
  assert.equal(urlMatches(meta, 'https://web.telegram.org/k/'), false, 'exclude vence');
  assert.equal(urlMatches(meta, 'https://exemplo.com/'), false);
  assert.equal(urlMatches(meta, 'http://web.whatsapp.com/'), false, 'esquema diferente');
});

test('urlMatches aceita @include com glob e regex', () => {
  const glob = parseHeader('// ==UserScript==\n// @name a\n// @include https://site.com/*/pagina\n// ==/UserScript==');
  assert.equal(urlMatches(glob, 'https://site.com/x/pagina'), true);
  const regex = parseHeader('// ==UserScript==\n// @name a\n// @include /^https:\\/\\/a\\.com\\/\\d+$/\n// ==/UserScript==');
  assert.equal(urlMatches(regex, 'https://a.com/12'), true);
  assert.equal(urlMatches(regex, 'https://a.com/x'), false);
});

test('parseHeader lê @require, @resource e @connect e normaliza os nomes GM.*', () => {
  const meta = parseHeader([
    '// ==UserScript==',
    '// @name Completo',
    '// @require https://cdn.jsdelivr.net/npm/lib@1/x.js',
    '// @require https://cdn.jsdelivr.net/npm/outra.js',
    '// @resource css https://cdn.jsdelivr.net/npm/estilo.css',
    '// @connect api.exemplo.com',
    '// @grant GM.getValue',
    '// @grant GM.xmlHttpRequest',
    '// ==/UserScript==',
  ].join('\n'));
  assert.deepEqual(meta.require, ['https://cdn.jsdelivr.net/npm/lib@1/x.js', 'https://cdn.jsdelivr.net/npm/outra.js']);
  assert.deepEqual(meta.resource, ['css https://cdn.jsdelivr.net/npm/estilo.css']);
  assert.deepEqual(meta.connect, ['api.exemplo.com']);
  assert.deepEqual(meta.grant, ['GM_getValue', 'GM_xmlhttpRequest']);
});

test('domínios: normalizarDominio e hostCasa', () => {
  const { normalizarDominio, hostCasa, hostDe } = require('../src/userscripts');
  assert.equal(normalizarDominio('https://Exemplo.com/caminho'), 'exemplo.com');
  assert.equal(normalizarDominio('*.exemplo.com'), 'exemplo.com');
  assert.equal(normalizarDominio('localhost'), null);
  assert.equal(normalizarDominio(''), null);
  assert.equal(hostCasa('a.exemplo.com', 'exemplo.com'), true);
  assert.equal(hostCasa('exemplo.com', 'exemplo.com'), true);
  assert.equal(hostCasa('exemplo.com.evil.net', 'exemplo.com'), false);
  assert.equal(hostCasa('xexemplo.com', 'exemplo.com'), false);
  assert.equal(hostDe('não é url'), null);
});
