'use strict';

// Interface da barra de abas e das Opções. Todo texto vindo do app entra com textContent (nunca innerHTML).

let estado = null;
let editandoConta = null; // conta com o nome em edição: a lista não é redesenhada enquanto isso
let chaveListaFrente = null; // evita refazer o menu de conversas (e perder a escolha) a cada atualização

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, texto = null) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else node.setAttribute(k, v);
  }
  if (texto !== null) node.textContent = texto;
  return node;
}

function mostrarErro(msg) {
  const box = $('erro');
  box.textContent = msg;
  box.classList.remove('hidden');
  clearTimeout(mostrarErro._t);
  mostrarErro._t = setTimeout(() => box.classList.add('hidden'), 5000);
}

async function chamar(promessa) {
  const r = await promessa;
  if (!r.ok) mostrarErro(r.error);
  return r;
}

// Tema efetivo agora: no modo automático segue o sistema.
function temaEscuroAgora() {
  const tema = estado.tema || 'auto';
  return tema === 'escuro' || (tema !== 'claro' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function aplicarTema() {
  document.documentElement.dataset.tema = estado.tema || 'auto';
  // O botão mostra a ação: lua no tema claro (vai escurecer), sol no escuro (vai clarear).
  const escuro = temaEscuroAgora();
  $('icone-tema').setAttribute('d', escuro ? CAMINHOS.sol : CAMINHOS.lua);
  $('btn-tema').title = escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro';
  $('btn-tema').setAttribute('aria-label', $('btn-tema').title);
  for (const b of document.querySelectorAll('#tema-opcoes button')) {
    const ativo = b.dataset.tema === (estado.tema || 'auto');
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  }
}

// Ícones desenhados no mesmo traço dos botões (SVG fixo do próprio app, sem HTML vindo de fora).
const SVG_NS = 'http://www.w3.org/2000/svg';
const CAMINHOS = {
  aviao: 'M21 4L3 11l6 2 2 6 3-4 5 4z',
  fechar: 'M6 6l12 12M18 6L6 18',
  // Lua (tema claro, ação: escurecer) e sol (tema escuro, ação: clarear).
  lua: 'M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z',
  sol: 'M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
};
function icone(nome, classe = 'icone') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', classe);
  svg.setAttribute('aria-hidden', 'true');
  const caminho = document.createElementNS(SVG_NS, 'path');
  caminho.setAttribute('d', CAMINHOS[nome]);
  svg.appendChild(caminho);
  return svg;
}

// Glifo oficial do WhatsApp (pasta Brand Resource Center, Digital Glyph White RGB 2026, SVG 720×720).
// Não é desenhado à mão: a diretriz de marca pede o logotipo oficial, sem versões de outras fontes.
const GLIFO_WHATSAPP = {
  viewBox: '0 0 720 720',
  caminhos: [
    'M360,0C161.18,0,0,161.18,0,360c0,65.41,17.45,126.75,47.94,179.61L0,720l187.02-44.21c51.34,28.18,110.28,44.21,172.98,44.21,198.82,0,360-161.18,360-360S558.82,0,360,0ZM360,655.52c-60.17,0-116.13-17.98-162.82-48.87l-110.49,28.14,30.99-105.61c-33.53-47.93-53.2-106.26-53.2-169.19,0-163.21,132.31-295.52,295.52-295.52s295.52,132.31,295.52,295.52-132.31,295.52-295.52,295.52Z',
    'M444.35,407.52l87.1,41.06c4,1.88,6.56,5.94,6.2,10.34-.94,11.46-5.54,34.43-26.13,55.02-58.12,58.12-162.49-7.64-166.74-10.18-25.67-13.79-50.06-32.24-73.19-55.36s-41.58-47.52-55.37-73.19c-2.55-4.24-68.31-108.61-10.18-166.74,20.59-20.59,43.56-25.19,55.02-26.13,4.41-.36,8.46,2.2,10.34,6.2l41.07,87.1c1.94,4.12,1.09,9.02-2.13,12.24l-30.61,30.61c-6.62,6.62-8.56,16.93-4,25.11,11.17,20.03,26.19,39.32,43.59,57.07,17.75,17.4,37.04,32.43,57.07,43.59,8.18,4.56,18.48,2.62,25.11-4l30.61-30.61c3.22-3.22,8.12-4.08,12.24-2.13Z',
  ],
};
function iconeMarca(marca) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', marca.viewBox);
  svg.setAttribute('class', 'icone marca');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of marca.caminhos) {
    const caminho = document.createElementNS(SVG_NS, 'path');
    caminho.setAttribute('d', d);
    svg.appendChild(caminho);
  }
  return svg;
}

// Mostra uma seção das Opções e marca o item da lateral.
function mostrarPagina(nome) {
  for (const b of document.querySelectorAll('.item-menu')) b.classList.toggle('ativo', b.dataset.pagina === nome);
  for (const p of document.querySelectorAll('.pagina')) p.classList.toggle('oculta', p.dataset.pagina !== nome);
  document.querySelector('.painel-conteudo').scrollTop = 0;
}

// Ícone do serviço (glifo do WhatsApp sobre verde, avião sobre azul para Telegram), usado nas abas e no cartão.
function avatarDoServico(servico) {
  const chave = servico === 'telegram' ? 'telegram' : 'whatsapp';
  const avatar = el('span', { className: 'avatar ' + chave });
  avatar.appendChild(chave === 'telegram' ? icone('aviao') : iconeMarca(GLIFO_WHATSAPP));
  return avatar;
}

const EASE_MOVIMENTO = 'cubic-bezier(.2,.8,.2,1)';
const TIPO_DESTAQUE = 'application/x-dm-destaque';
// Arrasto em andamento: { seletor, id, ids, lefts, centros, k, soltou }.
// As posições são medidas no início do arrasto (sem transform), então a prévia não oscila.
let arrasto = null;

function iniciarArrasto(seletor, id) {
  const elems = [...document.querySelectorAll(seletor + ' > *')].filter((c) => c.dataset.id);
  const rects = elems.map((c) => c.getBoundingClientRect());
  arrasto = {
    seletor, id,
    ids: elems.map((c) => c.dataset.id),
    lefts: rects.map((r) => r.left),
    centros: rects.map((r) => r.left + r.width / 2),
    k: null,
    soltou: false,
  };
}

// Posição do arrastado entre os outros: conta quantos centros de vizinhos ficaram antes do ponteiro.
function atualizarPrevia(clientX) {
  const { ids, lefts, centros, id } = arrasto;
  const de = ids.indexOf(id);
  let k = 0;
  ids.forEach((_x, j) => { if (j !== de && centros[j] < clientX) k++; });
  if (k === arrasto.k) return;
  arrasto.k = k;
  const nova = ids.filter((x) => x !== id);
  nova.splice(k, 0, id);
  for (const c of document.querySelectorAll(arrasto.seletor + ' > *')) {
    const j = ids.indexOf(c.dataset.id);
    if (j < 0) continue;
    const dx = lefts[nova.indexOf(c.dataset.id)] - lefts[j];
    c.style.transform = dx ? `translateX(${dx}px)` : '';
  }
}

// Índice de inserção para moverAba (src/abas.js), que espera a lista original com o item dentro.
function destinoDaPrevia() {
  const de = arrasto.ids.indexOf(arrasto.id);
  return arrasto.k > de ? arrasto.k + 1 : arrasto.k;
}

// Ao soltar, a barra é redesenhada pelo estado novo: as posições da prévia são mantidas até lá.
function encerrarArrasto() {
  if (arrasto && !arrasto.soltou) {
    for (const c of document.querySelectorAll(arrasto.seletor + ' > *')) c.style.transform = '';
  }
  arrasto = null;
}

// Posição horizontal de cada item (pelo id), antes de a barra ser redesenhada.
function capturarPosicoes(barra) {
  const posicoes = new Map();
  for (const c of barra.children) if (c.dataset.id) posicoes.set(c.dataset.id, c.getBoundingClientRect().left);
  return posicoes;
}

// Anima a troca de lugar: cada item desliza da posição antiga até a nova. Item novo aparece com zoom.
function animarReordenacao(barra, antes) {
  for (const c of barra.children) {
    if (!c.dataset.id) continue;
    const x = antes.get(c.dataset.id);
    if (x === undefined) {
      c.animate([{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_MOVIMENTO });
      continue;
    }
    const dx = x - c.getBoundingClientRect().left;
    if (Math.abs(dx) < 1) continue;
    c.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: 340, easing: EASE_MOVIMENTO });
  }
}

// Tira as marcas de arrastar. Com `tudo` falso, mantém o arrastar em andamento na aba (só limpa as marcas de alvo).

function renderAbas() {
  const barra = $('abas');
  const antes = capturarPosicoes(barra);
  barra.textContent = '';
  estado.openTabs.forEach((t, i) => {
    // Até 9 abas: Ctrl+1 … Ctrl+9 (Ctrl+Tab percorre todas).
    const dica = i < 9 ? ` · Ctrl+${i + 1}` : '';
    const aba = el('div', { className: 'aba' + (t.id === estado.activeId ? ' ativa' : ''), title: (t.title || t.name) + dica });
    aba.dataset.id = t.id;
    aba.addEventListener('click', () => chamar(window.dm.selectTab(t.id)));
    // Arrastar para reordenar (a prévia e a soltura são tratadas pela barra, ver init).
    aba.draggable = true;
    aba.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', t.id);
      e.dataTransfer.effectAllowed = 'move';
      iniciarArrasto('#abas', t.id);
      aba.classList.add('arrastando');
    });
    aba.addEventListener('dragend', encerrarArrasto);
    aba.appendChild(avatarDoServico(t.service));
    aba.appendChild(el('span', { className: 'nome' }, t.name));
    if (t.badge > 0) aba.appendChild(el('span', { className: 'badge' }, String(t.badge)));
    const x = el('button', { className: 'fechar', title: 'Fechar aba (a conta continua salva)', 'aria-label': 'Fechar aba' });
    x.appendChild(icone('fechar'));
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      chamar(window.dm.closeTab(t.id));
    });
    aba.appendChild(x);
    barra.appendChild(aba);
  });
  animarReordenacao(barra, antes);
  $('vazio').classList.toggle('hidden', estado.openTabs.length > 0);
}

// Abre ou fecha o menu e avisa o processo principal para expandir a barra.
function definirMenu(aberto) {
  $('menu-nova').classList.toggle('hidden', !aberto);
  document.documentElement.classList.toggle('menu-aberto', aberto);
  window.dm.setMenu(aberto);
}

function renderMenuNova() {
  const menu = $('menu-nova');
  menu.textContent = '';
  for (const s of estado.services) {
    const b = el('button', {});
    b.appendChild(avatarDoServico(s.key));
    b.appendChild(el('span', { className: 'nome-menu' }, s.label));
    b.addEventListener('click', () => {
      definirMenu(false);
      chamar(window.dm.newAccount(s.key));
    });
    menu.appendChild(b);
  }
  const fechadas = estado.accounts.filter((a) => !a.open);
  if (fechadas.length) {
    menu.appendChild(el('div', { className: 'rotulo' }, 'Contas salvas'));
    for (const a of fechadas) {
      const b = el('button', {});
      b.appendChild(avatarDoServico(a.service));
      b.appendChild(el('span', { className: 'nome-menu' }, a.name));
      b.addEventListener('click', () => {
        definirMenu(false);
        chamar(window.dm.openAccount(a.id));
      });
      menu.appendChild(b);
    }
  }
}

function renderFavoritas() {
  const barra = $('favoritas');
  const antes = capturarPosicoes(barra);
  barra.textContent = '';
  for (const [i, f] of estado.favoritas.entries()) {
    // A bolinha mostra o serviço (verde WhatsApp, azul Telegram); a conta aberta aparece com brilho.
    const servico = f.service === 'telegram' ? 'telegram' : 'whatsapp';
    const chip = el('button', { className: 'fav-chip ' + servico + (f.open ? ' aberta' : ''), title: f.accountName }, '★ ' + f.nome);
    chip.dataset.id = f.id;
    chip.addEventListener('click', () => chamar(window.dm.openFavorite(f.id)));
    // Botão direito libera o destaque (sai da faixa e de Opções › Destaques; a conversa não é afetada).
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      chamar(window.dm.removeFavorite(f.id));
    });
    // Arrastar para reordenar (prévia e soltura pela faixa, ver init).
    chip.draggable = true;
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(TIPO_DESTAQUE, f.id);
      e.dataTransfer.effectAllowed = 'move';
      iniciarArrasto('#favoritas', f.id);
      chip.classList.add('arrastando');
    });
    chip.addEventListener('dragend', encerrarArrasto);
    barra.appendChild(chip);
  }
  animarReordenacao(barra, antes);
  // A linha só existe com algum destaque (o main.js reserva a altura pelo mesmo critério).
  $('faixa-favoritas').classList.toggle('hidden', !estado.favoritas.length);
  requestAnimationFrame(atualizarSetasFavoritas);
  const select = $('fav-conta');
  const atual = select.value;
  select.textContent = '';
  for (const a of estado.accounts) {
    select.appendChild(el('option', { value: a.id }, a.name));
  }
  if (atual) select.value = atual;
  const lista = $('lista-fav');
  lista.textContent = '';
  if (!estado.favoritas.length) lista.appendChild(el('p', { className: 'nota' }, 'Nenhum destaque ainda.'));
  for (const f of estado.favoritas) {
    const item = el('div', { className: 'item' });
    const info = el('div');
    info.appendChild(el('div', { className: 'titulo' }, f.nome));
    info.appendChild(el('div', { className: 'sub' }, f.accountName));
    item.appendChild(info);
    const controles = el('div', { className: 'controles' });
    const abrir = el('button', { className: 'btn primario' }, 'Abrir');
    abrir.addEventListener('click', () => chamar(window.dm.openFavorite(f.id)));
    const remover = el('button', { className: 'btn perigo' }, 'Remover');
    remover.addEventListener('click', () => chamar(window.dm.removeFavorite(f.id)));
    controles.appendChild(abrir);
    controles.appendChild(remover);
    item.appendChild(controles);
    lista.appendChild(item);
  }
}

// Setas da linha de destaques, pela posição da rolagem:
// sem nada escondido, nenhuma; no início, só a da direita; no meio, as duas; no fim, só a da esquerda.
function atualizarSetasFavoritas() {
  const trilho = $('favoritas');
  const folga = trilho.scrollWidth - trilho.clientWidth; // quanto ainda dá para rolar
  const haMais = folga > 2;
  const mostraEsq = haMais && trilho.scrollLeft > 2;
  const mostraDir = haMais && trilho.scrollLeft < folga - 2;
  $('fav-esq').classList.toggle('hidden', !mostraEsq);
  $('fav-dir').classList.toggle('hidden', !mostraDir);
  trilho.classList.toggle('fade-esq', mostraEsq);
  trilho.classList.toggle('fade-dir', mostraDir);
}

function rolarFavoritas(direcao) {
  const trilho = $('favoritas');
  trilho.scrollBy({ left: direcao * trilho.clientWidth * 0.7, behavior: 'smooth' });
}

function iniciarFaixaFavoritas() {
  const trilho = $('favoritas');
  trilho.addEventListener('scroll', atualizarSetasFavoritas);
  new ResizeObserver(atualizarSetasFavoritas).observe(trilho);
  // Roda do mouse (vertical) também rola a linha na horizontal.
  trilho.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      trilho.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  $('fav-esq').addEventListener('click', () => rolarFavoritas(-1));
  $('fav-dir').addEventListener('click', () => rolarFavoritas(1));
}

// Menu de conversas da conta que estava na frente quando Opções foi aberta.
function renderListaFrente() {
  const sel = $('fav-lista');
  const lf = estado.listaFrente;
  const chave = lf ? `${lf.accountId}|${lf.nomes.join('\n')}` : 'nenhuma';
  if (chave === chaveListaFrente) return;
  chaveListaFrente = chave;
  sel.textContent = '';
  if (!lf) {
    sel.appendChild(el('option', { value: '' }, 'Abra a conta'));
    return;
  }
  sel.appendChild(el('option', { value: '' }, `Escolha uma conversa (${lf.nomes.length})`));
  for (const nome of lf.nomes) sel.appendChild(el('option', { value: nome }, nome));
  $('fav-conta').value = lf.accountId;
}

function renderScripts() {
  const lista = $('lista-scripts');
  const n = estado.scripts.length;
  $('scripts-resumo').textContent = n
    ? `${n} ${n === 1 ? 'userscript importado' : 'userscripts importados'}`
    : 'Nenhum userscript importado.';
  lista.textContent = '';
  for (const s of estado.scripts) {
    const item = el('div', { className: 'item' });
    const info = el('div');
    info.appendChild(el('div', { className: 'titulo' }, s.name + (s.version ? ' ' + s.version : '')));
    info.appendChild(el('div', { className: 'sub' }, s.enabled ? 'Ativo' : 'Desativado'));
    if (s.erro) info.appendChild(el('div', { className: 'erro-txt' }, 'Não executado: ' + s.erro));
    item.appendChild(info);
    const controles = el('div', { className: 'controles' });
    const toggle = el('button', { className: 'btn' }, s.enabled ? 'Desativar' : 'Ativar');
    toggle.addEventListener('click', () => chamar(window.dm.toggleScript(s.id, !s.enabled)));
    const remover = el('button', { className: 'btn perigo' }, 'Remover');
    remover.addEventListener('click', () => {
      if (confirm('Remover o script "' + s.name + '"?')) chamar(window.dm.removeScript(s.id));
    });
    controles.appendChild(toggle);
    controles.appendChild(remover);
    item.appendChild(controles);
    lista.appendChild(item);
  }

  const dominios = $('lista-dominios');
  dominios.textContent = '';
  if (!estado.dominios || estado.dominios.length === 0) {
    dominios.appendChild(el('div', { className: 'nota' }, 'Nenhum domínio cadastrado.'));
  }
  for (const d of estado.dominios || []) {
    const item = el('div', { className: 'item' });
    item.appendChild(el('div', { className: 'titulo' }, d));
    const controles = el('div', { className: 'controles' });
    const remover = el('button', { className: 'btn perigo' }, 'Remover');
    remover.addEventListener('click', () => chamar(window.dm.removeDomain(d)));
    controles.appendChild(remover);
    item.appendChild(controles);
    dominios.appendChild(item);
  }

  const comandos = $('lista-comandos');
  comandos.textContent = '';
  if (!estado.comandos || estado.comandos.length === 0) {
    comandos.appendChild(el('div', { className: 'nota' }, 'Nenhum comando de menu na aba da frente.'));
  }
  for (const c of estado.comandos || []) {
    const item = el('div', { className: 'item' });
    const info = el('div');
    info.appendChild(el('div', { className: 'titulo' }, c.nome));
    info.appendChild(el('div', { className: 'sub' }, c.script));
    item.appendChild(info);
    const controles = el('div', { className: 'controles' });
    const executar = el('button', { className: 'btn primario' }, 'Executar');
    executar.addEventListener('click', () => chamar(window.dm.runCommand(c.id)));
    controles.appendChild(executar);
    item.appendChild(controles);
    comandos.appendChild(item);
  }
}

// Troca o nome da conta por um campo de texto no próprio lugar. Enter salva, Esc cancela.
function iniciarRenomear(conta, titulo) {
  editandoConta = conta.id;
  const input = el('input', { className: 'editar-nome', type: 'text', maxlength: '40', 'aria-label': 'Nome da conta' });
  input.value = conta.name;
  let feito = false;
  const concluir = (salvar) => {
    if (feito) return;
    feito = true;
    const novo = input.value.trim();
    editandoConta = null;
    renderContas();
    if (salvar && novo && novo !== conta.name) chamar(window.dm.renameAccount(conta.id, novo));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') concluir(true);
    if (e.key === 'Escape') concluir(false);
  });
  input.addEventListener('blur', () => concluir(true));
  titulo.replaceWith(input);
  input.focus();
  input.select();
}

function renderContas() {
  if (editandoConta) return;
  const lista = $('lista-contas');
  lista.textContent = '';
  if (!estado.accounts.length) {
    lista.appendChild(el('p', { className: 'nota' }, 'Nenhuma conta criada.'));
  }
  for (const a of estado.accounts) {
    const item = el('div', { className: 'item' });
    const info = el('div');
    const titulo = el('div', { className: 'titulo' }, a.name);
    info.appendChild(titulo);
    info.appendChild(el('div', { className: 'sub' }, a.open ? 'Aberta' : 'Fechada (dados mantidos)'));
    item.appendChild(info);
    const controles = el('div', { className: 'controles' });
    const renomear = el('button', { className: 'btn' }, 'Renomear');
    renomear.addEventListener('click', () => iniciarRenomear(a, titulo));
    controles.appendChild(renomear);
    if (!a.open) {
      const abrir = el('button', { className: 'btn primario' }, 'Abrir');
      abrir.addEventListener('click', () => chamar(window.dm.openAccount(a.id)));
      controles.appendChild(abrir);
    }
    const excluir = el('button', { className: 'btn perigo' }, 'Excluir dados');
    excluir.addEventListener('click', () => {
      if (confirm(`Excluir "${a.name}"? Login e dados locais dessa conta serão apagados. Não tem volta.`)) {
        chamar(window.dm.deleteAccount(a.id));
      }
    });
    controles.appendChild(excluir);
    item.appendChild(controles);
    lista.appendChild(item);
  }
}

// Opções › Transcrição: mostra o estado e o progresso da preparação (vem do processo principal).
function renderTranscricao() {
  const t = estado.transcricao;
  if (!t) return;
  const titulo = $('tr-titulo');
  const sub = $('tr-sub');
  const btn = $('btn-tr');
  const barraCheia = $('tr-barra');
  if (t.rodando) {
    titulo.textContent = 'Preparando…';
    sub.textContent = t.texto || '';
  } else if (t.erro) {
    titulo.textContent = 'Não foi possível preparar';
    sub.textContent = t.erro;
  } else if (t.pronto) {
    titulo.textContent = 'Pronta para usar';
    sub.textContent = 'Toque em Transcrever numa mensagem de voz do WhatsApp.';
  } else {
    titulo.textContent = 'Não preparada';
    sub.textContent = 'Baixa o modelo de voz (487 MB) e prepara o programa de transcrição. Leva alguns minutos.';
  }
  btn.disabled = !!t.rodando;
  btn.textContent = t.pronto && !t.rodando ? 'Preparar de novo' : 'Preparar';
  $('tr-progresso').classList.toggle('hidden', !t.rodando);
  barraCheia.style.width = t.pct == null ? '' : `${Math.round(t.pct * 100)}%`;
  barraCheia.classList.toggle('indeterminada', t.pct == null);
}

function render(novo) {
  estado = novo;
  $('versao-app').textContent = 'Versão ' + estado.versao;
  aplicarTema();
  renderAbas();
  renderMenuNova();
  renderFavoritas(); // os chips ficam na barra, então renderizam sempre
  $('painel').classList.toggle('hidden', !estado.panelOpen);
  // Com a barra compacta (painel fechado) o aviso de erro fica dentro dela, onde dá para ver.
  document.documentElement.classList.toggle('compacto', !estado.panelOpen);
  if (estado.panelOpen) {
    renderListaFrente(); // depois de renderFavoritas: ela repõe a lista de contas
    renderScripts();
    renderContas();
    renderTranscricao();
  }
}

function init() {
  // A prévia vale para a barra inteira: basta o ponteiro estar sobre ela, não sobre uma aba específica.
  $('abas').addEventListener('dragover', (e) => {
    if (!arrasto || arrasto.seletor !== '#abas') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    atualizarPrevia(e.clientX);
  });
  $('abas').addEventListener('drop', (e) => {
    if (!arrasto || arrasto.seletor !== '#abas') return;
    e.preventDefault();
    const origem = arrasto.id;
    const destino = destinoDaPrevia();
    arrasto.soltou = true;
    chamar(window.dm.moveTab(origem, destino));
  });
  $('favoritas').addEventListener('dragover', (e) => {
    if (!arrasto || arrasto.seletor !== '#favoritas' || !e.dataTransfer.types.includes(TIPO_DESTAQUE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    atualizarPrevia(e.clientX);
  });
  $('favoritas').addEventListener('drop', (e) => {
    if (!arrasto || arrasto.seletor !== '#favoritas' || !e.dataTransfer.types.includes(TIPO_DESTAQUE)) return;
    e.preventDefault();
    const origem = arrasto.id;
    const destino = destinoDaPrevia();
    arrasto.soltou = true;
    chamar(window.dm.moveFavorite(origem, destino));
  });
  $('btn-nova').addEventListener('click', (e) => {
    e.stopPropagation();
    definirMenu($('menu-nova').classList.contains('hidden'));
  });
  document.addEventListener('click', () => {
    if (!$('menu-nova').classList.contains('hidden')) definirMenu(false);
  });

  iniciarFaixaFavoritas();
  $('btn-opcoes').addEventListener('click', () => chamar(window.dm.setPanel(true)));
  $('btn-tema').addEventListener('click', () => chamar(window.dm.setTheme(temaEscuroAgora() ? 'claro' : 'escuro')));
  // Com o tema automático, o ícone acompanha a troca do sistema.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => aplicarTema());
  $('btn-scripts').addEventListener('click', () => {
    mostrarPagina('scripts');
    chamar(window.dm.setPanel(true));
  });
  // ★ da barra: abre Opções já na página Destaques. A página muda antes, para não esperar a lista da conta.
  $('btn-destaques').addEventListener('click', () => {
    mostrarPagina('destaques');
    chamar(window.dm.setPanel(true));
  });
  $('btn-fechar-painel').addEventListener('click', () => chamar(window.dm.setPanel(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && estado && estado.panelOpen && !editandoConta) chamar(window.dm.setPanel(false));
  });
  for (const b of document.querySelectorAll('.item-menu')) {
    b.addEventListener('click', () => mostrarPagina(b.dataset.pagina));
  }
  for (const b of document.querySelectorAll('[data-link]')) {
    b.addEventListener('click', () => chamar(window.dm.abrirLink(b.dataset.link)));
  }
  $('btn-add-script').addEventListener('click', () => chamar(window.dm.importScript()));
  $('btn-add-dominio').addEventListener('click', async () => {
    const r = await chamar(window.dm.addDomain($('dominio-novo').value));
    if (r.ok) $('dominio-novo').value = '';
  });
  $('dominio-novo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-add-dominio').click();
  });
  $('btn-add-fav').addEventListener('click', async () => {
    const nome = $('fav-nome').value;
    const conta = $('fav-conta').value;
    const r = await chamar(window.dm.addFavorite(conta, nome));
    if (r.ok) {
      $('fav-nome').value = '';
      $('fav-lista').value = '';
    }
  });
  $('fav-lista').addEventListener('change', (e) => {
    if (e.target.value) $('fav-nome').value = e.target.value;
  });
  for (const b of document.querySelectorAll('#tema-opcoes button')) {
    b.addEventListener('click', () => chamar(window.dm.setTheme(b.dataset.tema)));
  }

  $('btn-tr').addEventListener('click', () => chamar(window.dm.prepararTranscricao()));

  window.dm.onStateChanged(render);
  window.dm.getState().then((r) => {
    if (r.ok) render(r.value);
    else mostrarErro(r.error);
  });
}

init();
