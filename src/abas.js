'use strict';

// Reordena as abas abertas. `destino` é o índice de inserção na lista original
// (0 = antes da primeira, lista.length = depois da última). Devolve uma lista nova.
function moverAba(lista, id, destino) {
  const de = lista.indexOf(id);
  if (de < 0) return lista;
  const d = Math.max(0, Math.min(Number(destino) || 0, lista.length));
  // Quem está antes do destino sai da lista, então o destino recua uma posição.
  const para = de < d ? d - 1 : d;
  if (para === de) return lista.slice();
  const nova = lista.slice();
  nova.splice(de, 1);
  nova.splice(para, 0, id);
  return nova;
}

module.exports = { moverAba };
