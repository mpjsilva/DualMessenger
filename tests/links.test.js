'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { linkPermitido, LINKS_PERMITIDOS } = require('../src/links');

test('aceita só os endereços da lista (GitHub do projeto e LGPL)', () => {
  assert.equal(linkPermitido('https://github.com/mpjsilva/DualMessenger'), true);
  assert.equal(linkPermitido('https://www.gnu.org/licenses/lgpl-3.0.html'), true);
  assert.equal(LINKS_PERMITIDOS.size, 2);
});

test('recusa qualquer outro endereço, mesmo parecido', () => {
  for (const url of [
    'https://github.com/mpjsilva/DualMessenger/',
    'https://github.com/mpjsilva/outro',
    'http://github.com/mpjsilva/DualMessenger',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '',
  ]) {
    assert.equal(linkPermitido(url), false, url);
  }
});

test('recusa valores que não são texto', () => {
  assert.equal(linkPermitido(undefined), false);
  assert.equal(linkPermitido(null), false);
  assert.equal(linkPermitido({ toString: () => 'https://github.com/mpjsilva/DualMessenger' }), false);
});
