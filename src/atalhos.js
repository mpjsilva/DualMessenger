'use strict';

// Atalhos de teclado das abas. Recebe o evento "before-input-event" do Electron
// e devolve a ação, ou null quando a tecla não é um atalho do app.
//   Ctrl+Tab / Ctrl+Shift+Tab: próxima / anterior aba (com volta no fim)
//   Ctrl+1 … Ctrl+9: vai para a aba de mesmo número (se existir)

function acaoAtalho(input, totalAbas) {
  if (!input || input.type !== 'keyDown') return null;
  if (!input.control || input.alt || input.meta) return null;
  if (totalAbas < 1) return null;

  if (input.key === 'Tab') {
    return { tipo: input.shift ? 'anterior' : 'proxima' };
  }

  if (/^[1-9]$/.test(input.key)) {
    const indice = Number(input.key) - 1;
    if (indice < totalAbas) return { tipo: 'ir', indice };
  }
  return null;
}

// Índice da aba que vem depois (ou antes) da atual, com volta no fim da lista.
function proximoIndice(atual, total, direcao) {
  if (total < 1) return -1;
  if (atual < 0) return direcao > 0 ? 0 : total - 1;
  return (atual + direcao + total) % total;
}

module.exports = { acaoAtalho, proximoIndice };
