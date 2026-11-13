'use strict';

// Menu do botão direito nas páginas das contas. O Electron não mostra menu nenhum por conta
// própria, então sem isto o clique direito não faz nada (nem Copiar, nem Colar).
// montarModelo é puro (recebe os dados do clique e devolve a lista de itens), para ser testável.

function ehHttp(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function montarModelo(params, acoes) {
  const itens = [];
  const sep = () => {
    if (itens.length && itens[itens.length - 1].type !== 'separator') itens.push({ type: 'separator' });
  };
  const flags = params.editFlags || {};

  // Correção ortográfica: só dentro de campos de texto com palavra errada.
  if (params.isEditable && params.misspelledWord) {
    for (const s of (params.dictionarySuggestions || []).slice(0, 5)) {
      itens.push({ label: s, click: () => acoes.substituirPalavra(s) });
    }
    if (!(params.dictionarySuggestions || []).length) itens.push({ label: 'Sem sugestões', enabled: false });
    sep();
  }

  if (ehHttp(params.linkURL)) {
    itens.push({ label: 'Abrir link no navegador', click: () => acoes.abrirLink(params.linkURL) });
    itens.push({ label: 'Copiar endereço do link', click: () => acoes.copiarTexto(params.linkURL) });
    sep();
  }

  if (params.mediaType === 'image') {
    itens.push({ label: 'Copiar imagem', click: () => acoes.copiarImagem(params.x, params.y) });
    if (ehHttp(params.srcURL) || /^blob:/i.test(params.srcURL || '')) {
      itens.push({ label: 'Salvar imagem como…', click: () => acoes.salvarImagem(params.srcURL) });
    }
    sep();
  }

  if (params.isEditable) {
    itens.push({ label: 'Desfazer', role: 'undo', enabled: !!flags.canUndo });
    itens.push({ label: 'Refazer', role: 'redo', enabled: !!flags.canRedo });
    sep();
    itens.push({ label: 'Recortar', role: 'cut', enabled: !!flags.canCut });
    itens.push({ label: 'Copiar', role: 'copy', enabled: !!flags.canCopy });
    itens.push({ label: 'Colar', role: 'paste', enabled: !!flags.canPaste });
    itens.push({ label: 'Colar como texto simples', role: 'pasteAndMatchStyle', enabled: !!flags.canPaste });
    sep();
    itens.push({ label: 'Selecionar tudo', role: 'selectAll', enabled: !!flags.canSelectAll });
  } else if (params.selectionText && params.selectionText.trim()) {
    itens.push({ label: 'Copiar', role: 'copy' });
    sep();
    itens.push({ label: 'Selecionar tudo', role: 'selectAll' });
  } else if (!itens.length) {
    itens.push({ label: 'Selecionar tudo', role: 'selectAll' });
  }

  while (itens.length && itens[itens.length - 1].type === 'separator') itens.pop();
  return itens;
}

module.exports = { montarModelo, ehHttp };
