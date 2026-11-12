'use strict';

// Endereços que a tela de Créditos pode abrir no navegador do sistema. Qualquer outro é recusado.
const LINKS_PERMITIDOS = new Set([
  'https://github.com/mpjsilva/DualMessenger',
  'https://www.gnu.org/licenses/lgpl-3.0.html',
]);

function linkPermitido(url) {
  return typeof url === 'string' && LINKS_PERMITIDOS.has(url);
}

module.exports = { LINKS_PERMITIDOS, linkPermitido };
