'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { moverAba } = require('../src/abas');

test('move uma aba para a frente', () => {
  assert.deepEqual(moverAba(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
});

test('move uma aba para o fim', () => {
  assert.deepEqual(moverAba(['a', 'b', 'c'], 'a', 3), ['b', 'c', 'a']);
});

test('solta logo depois de si mesma não muda a ordem', () => {
  assert.deepEqual(moverAba(['a', 'b', 'c'], 'b', 1), ['a', 'b', 'c']);
  assert.deepEqual(moverAba(['a', 'b', 'c'], 'b', 2), ['a', 'b', 'c']);
});

test('troca com a vizinha da direita e da esquerda', () => {
  assert.deepEqual(moverAba(['a', 'b', 'c'], 'a', 2), ['b', 'a', 'c']);
  assert.deepEqual(moverAba(['a', 'b', 'c'], 'c', 1), ['a', 'c', 'b']);
});

test('id desconhecido ou destino fora da lista não quebram', () => {
  assert.deepEqual(moverAba(['a', 'b'], 'x', 0), ['a', 'b']);
  assert.deepEqual(moverAba(['a', 'b'], 'a', 99), ['b', 'a']);
  assert.deepEqual(moverAba(['a', 'b'], 'b', -5), ['b', 'a']);
});
