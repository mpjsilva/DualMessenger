// Injetado no mundo principal da página do WhatsApp Web (ver src/main.js).
// Põe um botão "Transcrever" em cada mensagem de voz. Ao clicar, pega o áudio pelos
// módulos internos do WhatsApp (sem precisar tocar a mensagem) e pede a transcrição ao app.
// Os seletores e módulos internos dependem da versão do WhatsApp Web: se mudar, ajustar aqui.
(function () {
  if (window.__dmTranscricao) return;
  window.__dmTranscricao = true;

  const ICONE_PLAY = 'ic-play-arrow-filled';

  const estilo = document.createElement('style');
  estilo.textContent = `
    /* Visual do app: azul de destaque, vermelho de aviso (#ff3b30 / #ff453a), cantos arredondados. */
    .dm-tr { display: block; box-sizing: border-box; width: 100%; margin: 6px 0 2px; font: 13px -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .dm-tr button { border: none; border-radius: 999px; padding: 6px 14px; background: #0a84ff; color: #fff;
      font: 600 12.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif; box-shadow: 0 1px 2px rgba(0, 0, 0, .18); cursor: pointer; }
    .dm-tr button:disabled { opacity: .55; cursor: default; }
    /* Reserva espaço à direita e embaixo para a hora da mensagem (msg-meta), que fica no canto do balão. */
    .dm-tr .dm-tr-texto { margin-top: 8px; padding: 0 56px 20px 0; white-space: pre-wrap; line-height: 1.45; opacity: .95; overflow-wrap: anywhere; word-break: break-word; }
    .dm-tr .dm-tr-rotulo { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; opacity: .55; }
    .dm-tr .dm-tr-aviso { margin: 8px 56px 18px 0; padding: 9px 12px; border-radius: 12px; background: rgba(255, 59, 48, .10);
      box-shadow: inset 0 0 0 .5px rgba(255, 59, 48, .35); }
    .dm-tr .dm-tr-aviso-titulo { font-weight: 600; font-size: 12.5px; color: #ff453a; }
    .dm-tr .dm-tr-aviso-detalhe { margin-top: 2px; font-size: 12px; line-height: 1.4; opacity: .8; }
  `;
  document.head.appendChild(estilo);

  // Opções do app (Opções › Transcrição), recebidas pela ponte. auto: transcreve sozinho as mensagens novas.
  let opcoes = { auto: false, videos: true };
  const inicioEm = Date.now();
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.canal !== 'dm-transcricao:opcoes') return;
    opcoes = { auto: d.auto === true, videos: d.videos !== false };
    if (!opcoes.videos) for (const b of document.querySelectorAll('.dm-tr-video')) b.remove();
    else varrerVideos();
    if (opcoes.auto) varrer();
  });
  window.postMessage({ canal: 'dm-transcricao:opcoes-pedir' }, location.origin);

  // Módulos internos do WhatsApp. Podem não existir logo no início: tenta de novo quando precisa.
  function modulosWA() {
    try {
      const Coll = require('WAWebCollections');
      const Cache = require('WAWebMediaInMemoryBlobCache');
      if (Coll && Coll.Msg && Cache && Cache.InMemoryMediaBlobCache) {
        return { Msg: Coll.Msg, Cache: Cache.InMemoryMediaBlobCache };
      }
    } catch (e) {
      // ainda carregando
    }
    return null;
  }

  function acharMensagem(m, id) {
    return m.Msg._models.find((x) => x.id && (x.id._serialized === id || x.id.id === id)) || null;
  }

  // tipos: tipos de mensagem aceitos (áudio: ptt/audio; vídeo: video).
  async function obterAudio(id, tipos = ['ptt', 'audio']) {
    const m = modulosWA();
    if (!m) throw new Error('o WhatsApp ainda está carregando; tente de novo');
    const msg = acharMensagem(m, id);
    if (!msg) throw new Error('mensagem não encontrada; role a conversa até ela e tente de novo');
    if (!tipos.includes(msg.type)) throw new Error(tipos.includes('video') ? 'esta mensagem não é um vídeo' : 'esta mensagem não é um áudio');

    for (let tentativa = 0; tentativa < 20; tentativa++) {
      if (msg.filehash) {
        const url = m.Cache.getOrCreateURL(msg.filehash);
        if (url) return (await fetch(url)).blob();
      }
      if (tentativa === 0 && msg.downloadMedia) {
        msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true }).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    throw new Error(tipos.includes('video') ? 'o vídeo ainda não foi baixado; toque nele uma vez e tente de novo' : 'o áudio ainda não foi baixado; toque nele uma vez e tente de novo');
  }

  function extensaoDe(tipo) {
    if (/quicktime/.test(tipo)) return 'mov';
    if (/3gpp/.test(tipo)) return '3gp';
    if (/matroska/.test(tipo)) return 'mkv';
    if (/ogg/.test(tipo)) return 'ogg';
    if (/mp4|m4a|aac/.test(tipo)) return 'mp4';
    if (/webm/.test(tipo)) return 'webm';
    if (/mpeg|mp3/.test(tipo)) return 'mp3';
    return 'ogg';
  }

  // Manda o áudio ao app pela ponte (src/preload-transcricao.js) e espera a resposta.
  // Cada trecho transcrito chega como 'dm-transcricao:parcial' (onParcial) e renova o prazo de 5 min sem resposta.
  function pedirAoApp(id, buffer, ext, onParcial, video = false) {
    return new Promise((resolve, reject) => {
      const reqId = crypto.randomUUID();
      const PRAZO = 5 * 60 * 1000;
      let timer = null;
      function prazo() {
        clearTimeout(timer);
        timer = setTimeout(() => {
          window.removeEventListener('message', ouvir);
          reject(new Error('o app não respondeu a tempo'));
        }, PRAZO);
      }
      function ouvir(e) {
        const d = e.data;
        if (e.source !== window || !d || d.reqId !== reqId) return;
        if (d.canal === 'dm-transcricao:parcial') {
          prazo();
          if (onParcial) onParcial(d.texto);
          return;
        }
        if (d.canal !== 'dm-transcricao:resposta') return;
        clearTimeout(timer);
        window.removeEventListener('message', ouvir);
        resolve(d);
      }
      prazo();
      window.addEventListener('message', ouvir);
      window.postMessage({ canal: 'dm-transcricao:pedido', reqId, id, ext, video, buffer }, location.origin, [buffer]);
    });
  }

  function rotulo(area) {
    area.textContent = '';
    const r = document.createElement('div');
    r.className = 'dm-tr-rotulo';
    r.textContent = 'Transcrição';
    area.appendChild(r);
  }

  function mostrar(area, texto) {
    rotulo(area);
    const p = document.createElement('div');
    p.className = 'dm-tr-texto';
    p.textContent = texto;
    area.appendChild(p);
  }

  // Aviso no tom do app: título fixo e o motivo logo abaixo.
  function mostrarAviso(area, detalhe) {
    rotulo(area);
    const caixa = document.createElement('div');
    caixa.className = 'dm-tr-aviso';
    const titulo = document.createElement('div');
    titulo.className = 'dm-tr-aviso-titulo';
    titulo.textContent = 'Não foi possível transcrever';
    const motivo = document.createElement('div');
    motivo.className = 'dm-tr-aviso-detalhe';
    motivo.textContent = detalhe;
    caixa.append(titulo, motivo);
    area.appendChild(caixa);
  }

  // Motivo em frase: maiúscula no início e ponto no fim.
  function frase(texto) {
    const t = String(texto || '').trim();
    if (!t) return 'Erro desconhecido.';
    const m = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?]$/.test(m) ? m : m + '.';
  }

  async function transcrever(botao, area, id, video = false) {
    botao.disabled = true;
    botao.textContent = 'Transcrevendo…';
    try {
      const blob = await obterAudio(id, video ? ['video'] : ['ptt', 'audio']);
      const buffer = await blob.arrayBuffer();
      // O texto vai aparecendo a cada trecho de 15 s; a resposta final troca pelo texto completo.
      const r = await pedirAoApp(id, buffer, extensaoDe(blob.type), (texto) => {
        if (texto) mostrar(area, texto);
      }, video);
      if (!r.ok) throw new Error(r.erro);
      mostrar(area, r.texto || '(sem fala reconhecível)');
    } catch (err) {
      mostrarAviso(area, frase(err.message));
    } finally {
      botao.remove();
    }
  }

  // Sobe a partir do ícone de play até o bloco que contém a hora da mensagem (msg-meta):
  // é o balão da mensagem, onde o texto precisa ficar.
  function acharBalao(icone) {
    let el = icone.parentElement;
    while (el && el !== document.body) {
      if (el.querySelector('[data-testid="msg-meta"]')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function montarBotao(id, balao, video = false, nova = false) {
    const barra = document.createElement('div');
    barra.className = 'dm-tr' + (video ? ' dm-tr-video' : '');
    if (nova) barra.dataset.dmNova = '1';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = video ? 'Transcrever vídeo' : 'Transcrever';
    const area = document.createElement('div');
    botao.addEventListener('click', (e) => {
      e.stopPropagation();
      transcrever(botao, area, id, video);
    });
    barra.appendChild(botao);
    barra.appendChild(area);
    // Antes da hora: o texto vem antes e a hora fica depois (ou por cima, no canto, sem cobrir o texto).
    const meta = balao.querySelector('[data-testid="msg-meta"]');
    let ref = meta;
    while (ref && ref.parentElement !== balao) ref = ref.parentElement;
    if (ref) balao.insertBefore(barra, ref);
    else balao.appendChild(barra);
  }

  function varrer() {
    const m = modulosWA();
    for (const t of document.querySelectorAll('title')) {
      if (!t.textContent.includes(ICONE_PLAY)) continue;
      const linha = t.closest('[data-id]');
      if (!linha) continue;
      const balao = acharBalao(t);
      if (!balao || balao.querySelector('.dm-tr')) continue;
      const id = linha.getAttribute('data-id');
      let nova = false;
      if (m) {
        const msg = acharMensagem(m, id);
        if (msg && msg.type !== 'ptt' && msg.type !== 'audio') continue; // vídeo etc.
        // Nova = chegou depois que o app abriu (margem de 60 s para diferença de relógio).
        nova = !!(msg && msg.t && msg.t * 1000 >= inicioEm - 60000);
      }
      montarBotao(id, balao, false, nova);
    }
    autoTranscrever();
  }

  // Transcrição automática: aperta o botão das mensagens de voz novas, uma vez por mensagem.
  function autoTranscrever() {
    if (!opcoes.auto) return;
    for (const barra of document.querySelectorAll('.dm-tr[data-dm-nova="1"]:not(.dm-tr-video):not([data-dm-auto])')) {
      const botao = barra.querySelector('button');
      barra.dataset.dmAuto = '1';
      if (botao && !botao.disabled) botao.click();
    }
  }

  // Vídeos: acha as mensagens de vídeo pelo tipo (módulos internos) e põe o botão no balão.
  function varrerVideos() {
    const m = modulosWA();
    if (!m || !opcoes.videos) return;
    for (const linha of document.querySelectorAll('[data-id]')) {
      const meta = linha.querySelector('[data-testid="msg-meta"]');
      if (!meta || linha.querySelector('.dm-tr')) continue;
      const id = linha.getAttribute('data-id');
      const msg = acharMensagem(m, id);
      if (!msg || msg.type !== 'video') continue;
      let balao = meta.parentElement;
      while (balao && balao !== linha && !balao.querySelector('img, canvas, video')) balao = balao.parentElement;
      if (!balao || balao === linha) balao = meta.parentElement;
      if (balao) montarBotao(id, balao, true);
    }
  }

  let agendado = null;
  const observer = new MutationObserver(() => {
    clearTimeout(agendado);
    agendado = setTimeout(() => { varrer(); varrerVideos(); }, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  varrer();
  varrerVideos();
})();
