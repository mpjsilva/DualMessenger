'use strict';

// Lista de conversas de cada serviço, para os Destaques: lê os nomes da conta que está na frente
// e abre uma conversa pelo nome. Os seletores dependem do HTML de cada site: se mudarem, ajustar aqui.
//  - WhatsApp Web: linhas [data-testid="cell-frame-container"], nome em span[title].
//  - Telegram Web A: itens .chat-item-clickable, nome em h3.fullName (classes do Telegram Web A).

const SERVICOS_COM_LISTA = ['whatsapp', 'telegram'];

const POR_SERVICO = {
  whatsapp: {
    linha: '[data-testid="cell-frame-container"]',
    nome: (s) => (s.getAttribute('title') || '').trim(),
    alvo: 'span[title]',
    clique: '[role="listitem"], [data-testid="cell-frame-container"]',
  },
  telegram: {
    linha: '.chat-item-clickable',
    nome: (h) => (h.textContent || '').trim(),
    alvo: 'h3.fullName',
    clique: '.chat-item-clickable',
  },
};

// Script que devolve os nomes das conversas visíveis (até 500, sem repetir).
function scriptLerLista(servico) {
  const c = POR_SERVICO[servico];
  if (!c) return null;
  return `(function () {
    var nomes = [];
    var ler = ${c.nome.toString()};
    document.querySelectorAll(${JSON.stringify(c.linha)}).forEach(function (linha) {
      var s = linha.querySelector(${JSON.stringify(c.alvo)});
      var t = s ? ler(s) : '';
      if (t && nomes.indexOf(t) === -1) nomes.push(t);
    });
    return nomes.slice(0, 500);
  })();`;
}

// Script que procura a conversa pelo nome e clica nela. Devolve 'ok' ou 'nao-encontrada'.
// Espera até 15 segundos: a lista desenha depois que a página carrega.
function scriptAbrirConversa(servico, nome) {
  const c = POR_SERVICO[servico];
  if (!c) return null;
  return `(async function (nome) {
    var ler = ${c.nome.toString()};
    var achar = function () {
      return Array.prototype.find.call(document.querySelectorAll(${JSON.stringify(c.alvo)}), function (s) {
        return ler(s) === nome;
      });
    };
    var el = achar();
    for (var i = 0; !el && i < 75; i++) {
      await new Promise(function (r) { setTimeout(r, 200); });
      el = achar();
    }
    if (!el) return 'nao-encontrada';
    var linha = el.closest(${JSON.stringify(c.clique)}) || el;
    ['mousedown', 'mouseup', 'click'].forEach(function (tipo) {
      linha.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window }));
    });
    return 'ok';
  })(${JSON.stringify(nome)});`;
}

module.exports = { SERVICOS_COM_LISTA, scriptLerLista, scriptAbrirConversa };
