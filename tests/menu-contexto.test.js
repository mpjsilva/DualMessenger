'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { montarModelo } = require('../src/menu-contexto');

const acoes = () => {
  const chamadas = [];
  const f = (nome) => (...a) => chamadas.push([nome, ...a]);
  return {
    chamadas,
    substituirPalavra: f('substituirPalavra'),
    abrirLink: f('abrirLink'),
    copiarTexto: f('copiarTexto'),
    copiarImagem: f('copiarImagem'),
    salvarImagem: f('salvarImagem'),
  };
};
const rotulos = (m) => m.filter((i) => i.type !== 'separator').map((i) => i.label);

test('imagem: oferece Copiar imagem e Salvar imagem, e copia pela posição do clique', () => {
  const a = acoes();
  const m = montarModelo({ mediaType: 'image', srcURL: 'blob:https://web.whatsapp.com/abc', x: 10, y: 20 }, a);
  assert.deepEqual(rotulos(m), ['Copiar imagem', 'Salvar imagem como…']);
  m[0].click();
  assert.deepEqual(a.chamadas, [['copiarImagem', 10, 20]]);
});

test('texto selecionado: Copiar e Selecionar tudo', () => {
  assert.deepEqual(rotulos(montarModelo({ selectionText: 'olá' }, acoes())), ['Copiar', 'Selecionar tudo']);
});

test('campo de texto: Recortar/Copiar/Colar conforme as permissões do campo', () => {
  const m = montarModelo({ isEditable: true, editFlags: { canCopy: true, canPaste: true } }, acoes());
  const colar = m.find((i) => i.label === 'Colar');
  const recortar = m.find((i) => i.label === 'Recortar');
  assert.equal(colar.enabled, true);
  assert.equal(recortar.enabled, false);
});

test('palavra errada: sugestões antes dos itens de edição', () => {
  const a = acoes();
  const m = montarModelo({ isEditable: true, misspelledWord: 'casa', dictionarySuggestions: ['casa', 'asa'] }, a);
  assert.equal(m[0].label, 'casa');
  m[1].click();
  assert.deepEqual(a.chamadas, [['substituirPalavra', 'asa']]);
});

test('link http(s): abrir no navegador e copiar; outros esquemas são ignorados', () => {
  const a = acoes();
  const m = montarModelo({ linkURL: 'https://exemplo.com/x' }, a);
  assert.deepEqual(rotulos(m).slice(0, 2), ['Abrir link no navegador', 'Copiar endereço do link']);
  m[0].click();
  assert.deepEqual(a.chamadas, [['abrirLink', 'https://exemplo.com/x']]);
  assert.ok(!rotulos(montarModelo({ linkURL: 'javascript:alert(1)' }, acoes())).includes('Abrir link no navegador'));
});

test('clique em área vazia ainda mostra um menu e não termina em separador', () => {
  const m = montarModelo({}, acoes());
  assert.deepEqual(rotulos(m), ['Selecionar tudo']);
  assert.notEqual(m[m.length - 1].type, 'separator');
});

test('rótulos começam com maiúscula', () => {
  const m = montarModelo({ isEditable: true, misspelledWord: 'x', dictionarySuggestions: [], linkURL: 'https://a.b', mediaType: 'image', srcURL: 'https://a.b/i.png' }, acoes());
  for (const r of rotulos(m).filter((l) => l !== 'Sem sugestões')) assert.match(r, /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/);
});
