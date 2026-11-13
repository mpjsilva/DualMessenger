'use strict';

// Ponte entre a página do WhatsApp ou do Telegram (mundo principal, onde estão os scripts
// de transcrição) e o processo principal. A página manda o áudio por postMessage; esta ponte
// só repassa ao processo principal e devolve o texto. Só funciona nesses dois sites.
const { ipcRenderer } = require('electron');

const SITES_TRANSCRICAO = ['web.whatsapp.com', 'web.telegram.org'];

if (SITES_TRANSCRICAO.includes(location.hostname)) {
  // Clique numa notificação (ver src/pagina-notificacao.js): o processo principal traz a conta para a frente.
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    if (e.data && e.data.canal === 'dm-notificacao:clique') ipcRenderer.send('conta:focar');
  });

  // Texto parcial: a cada trecho transcrito, o processo principal manda o texto até ali; a página mostra.
  ipcRenderer.on('transcricao:parcial', (_e, d) => {
    if (!d || !d.reqId) return;
    window.postMessage({ canal: 'dm-transcricao:parcial', reqId: d.reqId, texto: d.texto }, location.origin);
  });

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.canal !== 'dm-transcricao:pedido') return;

    let resposta;
    try {
      resposta = await ipcRenderer.invoke('transcricao:pedir', {
        id: d.id,
        ext: d.ext,
        video: d.video === true,
        bytes: new Uint8Array(d.buffer),
        reqId: d.reqId,
      });
    } catch (err) {
      resposta = { ok: false, erro: err.message };
    }
    window.postMessage({ canal: 'dm-transcricao:resposta', reqId: d.reqId, ...resposta }, location.origin);
  });
}
