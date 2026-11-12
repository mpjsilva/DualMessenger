// Injetado no mundo principal das páginas do WhatsApp e do Telegram Web (ver src/main.js).
// Troca Notification por uma versão que avisa o app quando a notificação é clicada: o app
// então mostra a janela e abre a conta. Sem isso, o clique só chega à página, que não sabe
// trazer a janela do app para frente.
(function () {
  if (window.__dmNotificacao || typeof Notification !== 'function') return;
  window.__dmNotificacao = true;

  const Original = Notification;
  function DMNotification(titulo, opcoes) {
    const n = new Original(titulo, opcoes);
    n.addEventListener('click', () => {
      window.postMessage({ canal: 'dm-notificacao:clique' }, location.origin);
    });
    return n;
  }
  // Herda protótipo e estáticos (permission, requestPermission), então o site não nota a troca.
  DMNotification.prototype = Original.prototype;
  Object.setPrototypeOf(DMNotification, Original);
  window.Notification = DMNotification;
})();
