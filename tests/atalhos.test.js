'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acaoAtalho, proximoIndice } = require('../src/atalhos');

const tecla = (key, extra = {}) => ({ type: 'keyDown', key, control: true, ...extra });

test('Ctrl+Tab vai para a próxima aba e Ctrl+Shift+Tab para a anterior', () => {
  assert.deepEqual(acaoAtalho(tecla('Tab'), 3), { tipo: 'proxima' });
  assert.deepEqual(acaoAtalho(tecla('Tab', { shift: true }), 3), { tipo: 'anterior' });
});

test('Ctrl+1 a Ctrl+9 escolhem a aba de mesmo número', () => {
  assert.deepEqual(acaoAtalho(tecla('1'), 5), { tipo: 'ir', indice: 0 });
  assert.deepEqual(acaoAtalho(tecla('5'), 5), { tipo: 'ir', indice: 4 });
  assert.deepEqual(acaoAtalho(tecla('9'), 9), { tipo: 'ir', indice: 8 });
});

test('Ctrl+número maior que a quantidade de abas não faz nada', () => {
  assert.equal(acaoAtalho(tecla('4'), 2), null);
  assert.equal(acaoAtalho(tecla('9'), 0), null);
});

test('Ctrl+0 não é atalho', () => {
  assert.equal(acaoAtalho(tecla('0'), 9), null);
});

test('sem Ctrl, com Alt ou Cmd, ou só ao soltar a tecla, não é atalho', () => {
  assert.equal(acaoAtalho({ type: 'keyDown', key: 'Tab', control: false }, 3), null);
  assert.equal(acaoAtalho(tecla('Tab', { alt: true }), 3), null);
  assert.equal(acaoAtalho(tecla('Tab', { meta: true }), 3), null);
  assert.equal(acaoAtalho({ type: 'keyUp', key: 'Tab', control: true }, 3), null);
});

test('Ctrl+Tab sem nenhuma aba não faz nada', () => {
  assert.equal(acaoAtalho(tecla('Tab'), 0), null);
});

test('proximoIndice dá a volta nas duas direções', () => {
  assert.equal(proximoIndice(0, 3, 1), 1);
  assert.equal(proximoIndice(2, 3, 1), 0);
  assert.equal(proximoIndice(0, 3, -1), 2);
  assert.equal(proximoIndice(-1, 3, 1), 0);
  assert.equal(proximoIndice(-1, 3, -1), 2);
  assert.equal(proximoIndice(0, 0, 1), -1);
});
