// Injetado no mundo principal da página do Telegram Web (ver src/main.js).
// Põe um botão "Transcrever" em cada mensagem de voz. O player do Telegram recebe o áudio
// como endereço blob: ou /progressive/; este script guarda esse áudio e o envia ao app.
// Se o áudio ainda não chegou, o Transcrever toca a mensagem por um instante e pausa.
// Seletores tirados do Telegram Web A (classes .Audio, .toggle-play, .waveform e o atributo
// data-message-id): se o Telegram mudar a estrutura, ajustar aqui.
(function () {
  if (window.__dmTranscricaoTelegram) return;
  window.__dmTranscricaoTelegram = true;

  const estilo = document.createElement('style');
  estilo.textContent = `
    /* Visual do app: azul de destaque, vermelho de aviso (#ff3b30 / #ff453a), cantos arredondados. */
    .dm-tr { display: block; box-sizing: border-box; width: 100%; margin: 6px 0 2px; font: 13px -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .dm-tr button { border: none; border-radius: 999px; padding: 6px 14px; background: #0a84ff; color: #fff;
      font: 600 12.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif; box-shadow: 0 1px 2px rgba(0, 0, 0, .18); cursor: pointer; }
    .dm-tr button:disabled { opacity: .55; cursor: default; }
    /* Reserva espaço à direita e embaixo para a hora da mensagem, que fica no canto do balão. */
    .dm-tr .dm-tr-texto { margin-top: 8px; padding: 0 56px 20px 0; white-space: pre-wrap; line-height: 1.45; opacity: .95; overflow-wrap: anywhere; word-break: break-word; }
    .dm-tr .dm-tr-rotulo { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; opacity: .55; }
    .dm-tr .dm-tr-aviso { margin: 8px 56px 18px 0; padding: 9px 12px; border-radius: 12px; background: rgba(255, 59, 48, .10);
      box-shadow: inset 0 0 0 .5px rgba(255, 59, 48, .35); }
    .dm-tr .dm-tr-aviso-titulo { font-weight: 600; font-size: 12.5px; color: #ff453a; }
    .dm-tr .dm-tr-aviso-detalhe { margin-top: 2px; font-size: 12px; line-height: 1.4; opacity: .8; }
  `;
  document.head.appendChild(estilo);


  // Prévia do vídeo em popup (não cobre o vídeo). Fecha no X, fora do cartão ou com Esc.
  const estiloPopup = document.createElement('style');
  estiloPopup.textContent = `
    .dm-pop { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, .55); font: 14px -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    .dm-pop-cartao { box-sizing: border-box; width: min(520px, calc(100vw - 32px)); max-height: 70vh; display: flex; flex-direction: column;
      background: #202c33; color: #e9edef; border-radius: 16px; box-shadow: 0 12px 40px rgba(0, 0, 0, .5); overflow: hidden; }
    .dm-pop-topo { display: flex; align-items: center; gap: 8px; padding: 14px 16px 8px; }
    .dm-pop-titulo { flex: 1; font-weight: 600; font-size: 15px; }
    .dm-pop-x { border: none; background: transparent; color: inherit; font-size: 20px; line-height: 1; cursor: pointer; opacity: .7; padding: 2px 6px; }
    .dm-pop-nota { padding: 0 16px 8px; font-size: 12px; opacity: .6; }
    .dm-pop-corpo { padding: 4px 16px 16px; overflow: auto; white-space: pre-wrap; line-height: 1.5; overflow-wrap: anywhere; user-select: text; }
    .dm-pop-erro { color: #ff453a; }
  `;
  document.head.appendChild(estiloPopup);

  const PREVIA_SEGUNDOS = 60;

  function abrirPopupVideo() {
    document.querySelectorAll('.dm-pop').forEach((p) => p.remove());
    const fundo = document.createElement('div');
    fundo.className = 'dm-pop';
    const cartao = document.createElement('div');
    cartao.className = 'dm-pop-cartao';
    const topo = document.createElement('div');
    topo.className = 'dm-pop-topo';
    const titulo = document.createElement('div');
    titulo.className = 'dm-pop-titulo';
    titulo.textContent = 'Prévia da transcrição do vídeo';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'dm-pop-x';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Fechar');
    topo.append(titulo, x);
    const nota = document.createElement('div');
    nota.className = 'dm-pop-nota';
    nota.textContent = `Só o primeiro minuto do vídeo é transcrito (${PREVIA_SEGUNDOS} s).`;
    const corpo = document.createElement('div');
    corpo.className = 'dm-pop-corpo';
    cartao.append(topo, nota, corpo);
    fundo.appendChild(cartao);
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', tecla, true); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
    x.addEventListener('click', fechar);
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(fundo);
    return {
      texto(t) { corpo.className = 'dm-pop-corpo'; corpo.textContent = t; },
      erro(t) { corpo.className = 'dm-pop-corpo dm-pop-erro'; corpo.textContent = t; },
    };
  }

  // Opções do app (Opções › Transcrição), recebidas pela ponte. auto: transcreve sozinho as mensagens novas.
  let opcoes = { auto: false, videos: true };
  let ultimaTroca = Date.now(); // abertura do app ou troca de conversa
  window.addEventListener('hashchange', () => { ultimaTroca = Date.now(); });
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.canal !== 'dm-transcricao:opcoes') return;
    opcoes = { auto: d.auto === true, videos: d.videos !== false };
    if (!opcoes.videos) for (const b of document.querySelectorAll('.dm-tr-video')) b.remove();
    else varrerVideos();
    if (opcoes.auto) varrer();
  });
  window.postMessage({ canal: 'dm-transcricao:opcoes-pedir' }, location.origin);

  // Áudio por mensagem: chave (conversa + id) -> Promise<Blob>, preenchido quando o player recebe o arquivo.
  // A conversa entra na chave porque o id da mensagem pode se repetir entre chats.
  const audios = new Map();
  const chave = (id) => `${location.hash}|${id}`;
  const log = (...args) => console.log('[DM]', ...args);
  // Último play clicado (a captura de um play feito pelo usuário vale por 15 s).
  let ultimoPlay = null;
  // Pedido de transcrição em andamento: o primeiro áudio de voz que chegar é o da mensagem pedida.
  // Fica armado desde antes do clique, porque o endereço pode chegar depois dele.
  let aguardando = null; // { id, ate }
  // Elemento que recebeu a voz pedida: só ele é pausado depois.
  let elementoPedido = null;

  // O Telegram começa a tocar no mousedown (antes do click), por isso o play é marcado nesse evento.
  document.addEventListener('pointerdown', marcarPlay, true);
  document.addEventListener('mousedown', marcarPlay, true);
  function marcarPlay(e) {
    const botao = e.target && e.target.closest ? e.target.closest('.Audio .toggle-play') : null;
    if (!botao) return;
    const linha = botao.closest('[data-message-id]');
    if (!linha) return;
    if (!ultimoPlay || ultimoPlay.id !== linha.dataset.messageId || Date.now() - ultimoPlay.quando > 1000) {
      log('play pressionado, mensagem', linha.dataset.messageId, '(' + e.type + ')');
    }
    ultimoPlay = { id: linha.dataset.messageId, quando: Date.now() };
  }

  // Um clique de verdade é uma sequência de eventos. O .click() sozinho não aciona o play do Telegram,
  // então o Transcrever manda a sequência completa (pointerdown, mousedown, pointerup, mouseup, click).
  function apertar(botao) {
    const r = botao.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const ponteiro = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    botao.dispatchEvent(new PointerEvent('pointerdown', { ...base, ...ponteiro, buttons: 1 }));
    botao.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    botao.dispatchEvent(new PointerEvent('pointerup', { ...base, ...ponteiro, buttons: 0 }));
    botao.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    botao.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0, detail: 1 }));
  }

  // O endereço /progressive/ só responde a pedidos com Range (é assim que o próprio player pede).
  // Baixa em pedaços até o fim do arquivo; com blob: o fetch devolve tudo de uma vez.
  async function baixarVoz(url, id) {
    const partes = [];
    let tipo = 'audio/ogg';
    let inicio = 0;
    let total = Infinity;
    try {
      while (inicio < total) {
        const r = await fetch(url, { headers: { Range: `bytes=${inicio}-` } });
        if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status);
        if (inicio === 0) tipo = r.headers.get('content-type') || tipo;
        const pedaco = await r.arrayBuffer();
        partes.push(pedaco);
        const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
        // Sem Content-Range, o corpo que veio já é o arquivo inteiro.
        total = m ? Number(m[1]) : inicio + pedaco.byteLength;
        if (pedaco.byteLength === 0) break;
        inicio += pedaco.byteLength;
      }
    } catch (err) {
      log('arquivo da mensagem', id, 'falhou:', err.message);
      throw err;
    }
    log('arquivo da mensagem', id, 'baixado:', inicio, 'bytes,', tipo);
    return new Blob(partes, { type: tipo });
  }

  // Guarda o áudio de voz (blob: ou /progressive/): da mensagem pedida, ou do último play recente.
  function capturar(elemento, valor, origem) {
    if (!(elemento instanceof HTMLAudioElement) || typeof valor !== 'string') return;
    const prefixo = valor.slice(0, 40);
    if (!(valor.startsWith('blob:') || valor.includes('/progressive/'))) {
      log(origem, prefixo, '- ignorado: não é voz');
      return;
    }
    const pedido = aguardando && Date.now() < aguardando.ate ? aguardando.id : null;
    const manual = ultimoPlay && Date.now() - ultimoPlay.quando < 15000 ? ultimoPlay.id : null;
    const id = pedido ?? manual;
    if (id === null) {
      log(origem, prefixo, '- rejeitado: nenhuma mensagem pedida nem play recente');
      return;
    }
    if (audios.has(chave(id))) {
      log(origem, prefixo, '- já capturado para a mensagem', id);
      return;
    }
    log(origem, prefixo, '- aceito para a mensagem', id);
    audios.set(chave(id), baixarVoz(valor, id));
    if (pedido !== null) elementoPedido = elemento;
  }

  // O player cria um elemento de áudio fora do DOM e lhe dá o arquivo (blob: ou progressivo).
  const descritor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    configurable: true,
    enumerable: descritor.enumerable,
    get: descritor.get,
    set(valor) {
      capturar(this, valor, 'src =');
      return descritor.set.call(this, valor);
    },
  });

  // Tocar pode acontecer sem nova atribuição de src (o elemento já tem o arquivo): captura também no play().
  const playOriginal = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    capturar(this, this.src, 'play()');
    if (aguardando && audios.has(chave(aguardando.id))) elementoPedido = this;
    // A transcrição só precisa do arquivo, que já foi capturado: o play dessa mensagem não toca.
    // O bloqueio dura até o fim da transcrição (ver transcrever).
    if (elementoPedido === this) {
      log('play() bloqueado: a transcrição só precisa do arquivo');
      return Promise.resolve();
    }
    return playOriginal.apply(this, args);
  };

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

  // Se o áudio ainda não chegou ao app, toca a própria mensagem: o player entrega o arquivo e o pedido
  // captura o primeiro áudio de voz que chegar. Espera até 30 segundos.
  async function garantirAudio(id) {
    if (audios.has(chave(id))) return;
    const botaoPlay = document.querySelector(`[data-message-id="${CSS.escape(String(id))}"] .Audio .toggle-play`);
    if (!botaoPlay) return;
    aguardando = { id: String(id), ate: Date.now() + 30000 };
    elementoPedido = null;
    log('transcrever: pedido da mensagem', id);
    apertar(botaoPlay);
    while (!audios.has(chave(id)) && Date.now() < aguardando.ate) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!audios.has(chave(id))) log('tempo esgotado: a voz da mensagem', id, 'não chegou');
    aguardando = null;
    // Se o áudio chegou a tocar mesmo assim, pausa. O bloqueio do play continua até o fim da transcrição.
    if (elementoPedido && !elementoPedido.paused) elementoPedido.pause();
  }

  async function transcrever(botao, area, id) {
    botao.disabled = true;
    botao.textContent = audios.has(chave(id)) ? 'Transcrevendo…' : 'Carregando áudio…';
    try {
      await garantirAudio(id);
      botao.textContent = 'Transcrevendo…';
      const pendente = audios.get(chave(id));
      if (!pendente) throw new Error('o áudio desta mensagem ainda não chegou; tente de novo em instantes');
      let blob;
      try {
        blob = await pendente;
      } catch {
        audios.delete(chave(id)); // a leitura falhou: a próxima tentativa carrega de novo
        throw new Error('não consegui ler o áudio; tente de novo');
      }
      log('voz pronta', blob.size, 'bytes', blob.type);
      const buffer = await blob.arrayBuffer();
      // O texto vai aparecendo a cada trecho de 15 s; a resposta final troca pelo texto completo.
      const r = await pedirAoApp(id, buffer, extensaoDe(blob.type), (texto) => {
        if (texto) mostrar(area, texto);
      });
      if (!r.ok) throw new Error(r.erro);
      mostrar(area, r.texto || '(sem fala reconhecível)');
      botao.remove();
    } catch (err) {
      // Sem o áudio, o botão continua: a pessoa tenta de novo.
      mostrarAviso(area, frase(err.message));
      botao.disabled = false;
      botao.textContent = 'Transcrever';
    } finally {
      elementoPedido = null; // a voz da mensagem volta a tocar normalmente
    }
  }

  // Vídeo: pega o endereço (blob: ou /progressive/) do <video> da própria mensagem e baixa o arquivo.
  // Se o vídeo ainda não carregou, aperta o controle de baixar/tocar uma vez e espera até 30 s.
  async function obterVideo(linha, id) {
    const achar = () => {
      const v = linha.querySelector('video');
      const url = v && (v.currentSrc || v.src);
      return url && (url.startsWith('blob:') || url.includes('/progressive/')) ? url : null;
    };
    let url = achar();
    if (!url) {
      const controle = linha.querySelector('.Video .download-button, .Video .media-loading, .Video');
      if (controle) apertar(controle);
      const limite = Date.now() + 30000;
      while (!url && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 300));
        url = achar();
      }
    }
    if (!url) throw new Error('o vídeo ainda não carregou; toque nele uma vez e tente de novo');
    return baixarVoz(url, id);
  }

  async function transcreverVideo(botao, linha, id) {
    botao.disabled = true;
    botao.textContent = 'Carregando vídeo…';
    const pop = abrirPopupVideo();
    pop.texto('Carregando o vídeo…');
    try {
      const blob = await obterVideo(linha, id);
      botao.textContent = 'Transcrevendo…';
      pop.texto('Transcrevendo…');
      const buffer = await blob.arrayBuffer();
      const r = await pedirAoApp(id, buffer, extensaoDe(blob.type || 'video/mp4'), (texto) => {
        if (texto) pop.texto(texto);
      }, true);
      if (!r.ok) throw new Error(r.erro);
      const final = r.texto || '(sem fala reconhecível)';
      pop.texto(final);
      botao.textContent = 'Ver prévia da transcrição';
      botao.dataset.previa = final;
    } catch (err) {
      pop.erro('Não foi possível transcrever. ' + frase(err.message));
      botao.textContent = 'Transcrever vídeo';
    } finally {
      botao.disabled = false;
    }
  }

  function montarBotaoVideo(linha, referencia) {
    const barra = document.createElement('div');
    barra.className = 'dm-tr dm-tr-video';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'Transcrever vídeo';
    const area = document.createElement('div');
    botao.addEventListener('click', (e) => {
      e.stopPropagation();
      if (botao.dataset.previa) abrirPopupVideo().texto(botao.dataset.previa);
      else transcreverVideo(botao, linha, linha.dataset.messageId);
    });
    barra.appendChild(botao);
    barra.appendChild(area);
    referencia.insertAdjacentElement('afterend', barra);
  }

  function varrerVideos() {
    if (!opcoes.videos) return;
    for (const midia of document.querySelectorAll('.Video')) {
      const linha = midia.closest('[data-message-id]');
      if (!linha || linha.querySelector('.dm-tr')) continue;
      // Figurinhas e GIFs animados não são vídeo com fala: só mídia dentro do balão da mensagem.
      const alvo = midia.closest('.media-inner') || midia;
      montarBotaoVideo(linha, alvo);
    }
  }

  function montarBotao(id, audio, nova = false) {
    const barra = document.createElement('div');
    barra.className = 'dm-tr';
    if (nova) barra.dataset.dmNova = '1';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'Transcrever';
    const area = document.createElement('div');
    botao.addEventListener('click', (e) => {
      e.stopPropagation();
      transcrever(botao, area, id);
    });
    barra.appendChild(botao);
    barra.appendChild(area);
    audio.insertAdjacentElement('afterend', barra);
  }

  // Só mensagens de voz têm o waveform (música e outros arquivos de áudio não têm).
  function varrer() {
    for (const forma of document.querySelectorAll('.Audio .waveform')) {
      const audio = forma.closest('.Audio');
      const linha = audio && audio.closest('[data-message-id]');
      if (!linha) continue;
      const proximo = audio.nextElementSibling;
      if (proximo && proximo.classList.contains('dm-tr')) continue;
      // Nova = uma das 3 últimas mensagens, e a conversa já estava aberta há mais de 4 s (histórico não conta).
      const linhas = [...document.querySelectorAll('[data-message-id]')];
      const nova = Date.now() - ultimaTroca > 4000 && linhas.indexOf(linha) >= linhas.length - 3;
      montarBotao(linha.dataset.messageId, audio, nova);
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

  let agendado = null;
  const observer = new MutationObserver(() => {
    clearTimeout(agendado);
    agendado = setTimeout(() => { varrer(); varrerVideos(); }, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  varrer();
  varrerVideos();
})();
