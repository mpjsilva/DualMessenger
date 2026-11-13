'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  app,
  BaseWindow,
  WebContentsView,
  session,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeTheme,
  clipboard,
} = require('electron');
const { readJson, writeJsonAtomic } = require('./store');
const { ScriptManager } = require('./motor');
const { registerGmIpc } = require('./gm-ipc');
const { acaoAtalho, proximoIndice } = require('./atalhos');
const { criarServicoTranscricao } = require('./transcricao-servico');
const { criarInstalador } = require('./transcricao-instalar');
const { ARQUIVO_ICONE, iconeDoApp } = require('./recursos');
const { moverAba } = require('./abas');
const { integrarSistema, ID_APP } = require('./sistema-linux');
const { linkPermitido } = require('./links');
const { SERVICOS_COM_LISTA, scriptLerLista, scriptAbrirConversa } = require('./conversas');
const { montarModelo } = require('./menu-contexto');

// Script que põe o botão "Transcrever" nas mensagens de voz (roda na página do WhatsApp).
const PAGINA_WHATSAPP = fs.readFileSync(path.join(__dirname, 'pagina-whatsapp.js'), 'utf8');
const PAGINA_TELEGRAM = fs.readFileSync(path.join(__dirname, 'pagina-telegram.js'), 'utf8');
// Clique numa notificação da página: traz a janela e abre a conta que a mandou.
const PAGINA_NOTIFICACAO = fs.readFileSync(path.join(__dirname, 'pagina-notificacao.js'), 'utf8');
// Sites que podem pedir transcrição pela ponte (ver src/preload-transcricao.js).
const ORIGENS_TRANSCRICAO = ['https://web.whatsapp.com/', 'https://web.telegram.org/'];

const TAB_BAR_HEIGHT = 56; // altura da barra flutuante (ver --barra em ui/styles.css)
const FAV_BAR_HEIGHT = 44; // linha dos destaques, que só existe quando há algum destaque (ver #faixa-favoritas)
const TEMAS = ['auto', 'claro', 'escuro'];

// O tema do app vale também para as páginas das contas: o Electron informa o modo ao site
// (prefers-color-scheme), e o WhatsApp e o Telegram seguem esse modo.
function aplicarTemaNasContas() {
  const modo = { auto: 'system', claro: 'light', escuro: 'dark' };
  nativeTheme.themeSource = modo[state.tema] || 'system';
}

// Serviços conhecidos. Cada conta nova ganha uma partição própria (cookies,
// IndexedDB, cache e localStorage separados), então o login de uma não afeta a outra.
const SERVICES = {
  whatsapp: { label: 'WhatsApp', url: 'https://web.whatsapp.com/', domain: 'whatsapp.com' },
  telegram: { label: 'Telegram', url: 'https://web.telegram.org/a/', domain: 'telegram.org' },
};

// O WhatsApp recusa user-agent de Electron; usa o de Chrome na mesma versão do motor.
const CHROME_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const ALLOWED_PERMISSIONS = ['notifications', 'media', 'clipboard-sanitized-write'];

let win = null;
let uiView = null;
let scripts = null;
let state = { accounts: [], openTabs: [], favoritas: [], tema: 'auto' }; // contas salvas, abas abertas, destaques e tema
const tabs = new Map(); // accountId -> { view, title, badge }
let activeId = null;
let panelOpen = false;
let listaFrente = null; // { accountId, nomes } lida da conta na frente ao abrir Opções
let transcricao = null; // serviço de transcrição local (criado ao iniciar)
let instalador = null; // prepara a transcrição (ferramentas, whisper.cpp, modelo)
let instalacao = { rodando: false, etapa: '', texto: '', pct: null, erro: null };
let menuOpen = false; // menu "+ Conta": a barra precisa ocupar a janela para o menu aparecer

const statePath = () => path.join(app.getPath('userData'), 'state.json');

function saveState() {
  writeJsonAtomic(statePath(), state);
}

function accountById(id) {
  return state.accounts.find((a) => a.id === id) || null;
}

function sameDomain(url, domain) {
  try {
    const host = new URL(url).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

// Contagem de não lidas no título: "(3) WhatsApp", "1 notificação" (Telegram alterna esse título)
// ou "Telegram (2)".
function parseBadge(title) {
  const t = String(title || '');
  const inicio = t.match(/^[^\d\s]{0,3}\s*\(?(\d+)\)?\s/);
  if (inicio) return Number(inicio[1]);
  const fim = t.match(/\((\d+)\)\s*$/);
  return fim ? Number(fim[1]) : 0;
}

function snapshot() {
  return {
    accounts: state.accounts
      .filter((a) => !a.transient)
      .map((a) => ({ id: a.id, service: a.service, name: a.name, open: state.openTabs.includes(a.id) })),
    openTabs: state.openTabs.map((id) => {
      const t = tabs.get(id);
      const acc = accountById(id);
      return { id, name: acc ? acc.name : id, service: acc ? acc.service : null, title: t ? t.title : '', badge: t ? t.badge : 0 };
    }),
    activeId,
    panelOpen,
    tema: state.tema,
    versao: app.getVersion(),
    transcricao: instalador ? { ...instalador.estado(), ...instalacao } : null,
    listaFrente,
    services: Object.entries(SERVICES).map(([key, s]) => ({ key, label: s.label })),
    scripts: scripts ? scripts.list() : [],
    dominios: scripts ? scripts.listarDominios() : [],
    comandos: scripts && activeId && tabs.has(activeId)
      ? scripts.comandosDaAba(tabs.get(activeId).view.webContents.id)
      : [],
    favoritas: state.favoritas.map((f) => {
      const acc = accountById(f.accountId);
      return { id: f.id, nome: f.nome, accountId: f.accountId, accountName: acc ? acc.name : '?', service: acc ? acc.service : null, open: state.openTabs.includes(f.accountId) };
    }),
  };
}

function broadcast() {
  if (uiView && !uiView.webContents.isDestroyed()) {
    uiView.webContents.send('state:changed', snapshot());
  }
}

// Altura do cabeçalho: a barra de abas e, se houver destaques, a linha própria dos destaques.
function alturaBarra() {
  const comDestaques = Boolean(state && state.favoritas && state.favoritas.length);
  return TAB_BAR_HEIGHT + (comDestaques ? FAV_BAR_HEIGHT : 0);
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const barra = alturaBarra();
  // Sem nenhuma aba, a UI ocupa a janela toda: é ela que desenha o estado vazio ("Nenhuma conta aberta").
  // Com a barra só, a área de baixo não era pintada por nenhuma view e ficava com restos de quadros.
  const expandida = panelOpen || menuOpen || tabs.size === 0;
  uiView.setBounds({ x: 0, y: 0, width: w, height: expandida ? h : barra });
  // Todas as abas ocupam a mesma área; só a da frente fica por cima (ver selectTab).
  // Com o painel aberto, as páginas ficam sem área (a UI cobre a janela).
  const height = panelOpen ? 0 : Math.max(0, h - barra);
  const area = { x: 0, y: barra, width: panelOpen ? 0 : w, height };
  for (const entry of tabs.values()) entry.view.setBounds(area);
}

// A barra de abas precisa ficar por cima da página, então sempre é a última view.
function bringUiToFront() {
  win.contentView.removeChildView(uiView);
  win.contentView.addChildView(uiView);
}

const sessoesComGM = new WeakSet();

function configureSession(ses) {
  ses.setUserAgent(CHROME_UA);
  if (!sessoesComGM.has(ses)) {
    // Ponte GM_* em cada página da conta (ver src/motor.js para as regras de acesso).
    ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload-gm.js') });
    // Ponte da transcrição (só age dentro de WhatsApp e Telegram).
    ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload-transcricao.js') });
    sessoesComGM.add(ses);
  }
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.includes(permission));
  });
}

async function openAccount(accountId, selecionar = true) {
  const acc = accountById(accountId);
  if (!acc) throw new Error('conta não encontrada');
  if (tabs.has(accountId)) {
    selectTab(accountId);
    return;
  }

  const service = SERVICES[acc.service];
  const ses = session.fromPartition(acc.partition);
  configureSession(ses);

  const view = new WebContentsView({
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });

  const entry = { view, title: acc.name, badge: 0 };
  tabs.set(accountId, entry);

  const wc = view.webContents;
  // Diagnóstico: com DM_DEVTOOLS=1 cada conta abre o DevTools (para inspecionar o HTML das mensagens).
  if (process.env.DM_DEVTOOLS) wc.openDevTools({ mode: 'detach' });
  wc.on('before-input-event', (event, input) => atalhoDaTecla(event, input));
  wc.setWindowOpenHandler(({ url }) => {
    // Pop-ups do próprio serviço (ex.: login, ligação) ficam na mesma conta.
    if (sameDomain(url, service.domain)) {
      openPopupInSameAccount(acc, url);
    } else if (/^https?:/.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  // Botão direito: Copiar, Colar, Copiar imagem, links e correção ortográfica.
  wc.on('context-menu', (_event, params) => {
    const modelo = montarModelo(params, {
      substituirPalavra: (palavra) => wc.replaceMisspelling(palavra),
      abrirLink: (url) => shell.openExternal(url),
      copiarTexto: (texto) => clipboard.writeText(texto),
      copiarImagem: (x, y) => wc.copyImageAt(x, y),
      salvarImagem: (url) => wc.downloadURL(url),
    });
    if (modelo.length) Menu.buildFromTemplate(modelo).popup({ window: win });
  });
  wc.on('page-title-updated', (event, title) => {
    entry.title = title;
    entry.badge = parseBadge(title);
    broadcast();
  });

  if (!state.openTabs.includes(accountId)) {
    state.openTabs.push(accountId);
    saveState();
  }
  // A cada carregamento completo da página, injeta os userscripts que combinam com a URL.
  wc.on('dom-ready', () => {
    scripts.injetar(wc).catch(() => {});
    if (acc.service === 'whatsapp') wc.executeJavaScript(PAGINA_WHATSAPP).catch(() => {});
    if (acc.service === 'telegram') wc.executeJavaScript(PAGINA_TELEGRAM).catch(() => {});
    wc.executeJavaScript(PAGINA_NOTIFICACAO).catch(() => {});
  });
  wc.loadURL(service.url).catch(() => {});
  if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
  if (selecionar || !activeId) {
    selectTab(accountId);
  } else {
    bringUiToFront();
    layout();
    broadcast();
  }
}

// Pop-up de mesma conta vira aba com a mesma partição, sem trocar de conta.
function openPopupInSameAccount(acc, url) {
  const popupId = `${acc.id}-${crypto.randomUUID().slice(0, 4)}`;
  state.accounts.push({ id: popupId, service: acc.service, name: `${acc.name} (pop-up)`, partition: acc.partition, transient: true });
  openAccount(popupId).then(() => {
    tabs.get(popupId)?.view.webContents.loadURL(url).catch(() => {});
  });
}

// Ctrl+Tab, Ctrl+Shift+Tab e Ctrl+1…9 funcionam com o foco na página ou na barra.
function atalhoDaTecla(event, input) {
  const acao = acaoAtalho(input, state.openTabs.length);
  if (!acao) return;
  event.preventDefault();
  if (acao.tipo === 'ir') return selectTab(state.openTabs[acao.indice]);
  // Ctrl+R: recarrega a aba da frente (é a saída quando a página trava).
  if (acao.tipo === 'recarregar') {
    const entry = activeId && tabs.get(activeId);
    if (entry) entry.view.webContents.reload();
    return;
  }
  const atual = state.openTabs.indexOf(activeId);
  const indice = proximoIndice(atual, state.openTabs.length, acao.tipo === 'proxima' ? 1 : -1);
  if (indice >= 0) selectTab(state.openTabs[indice]);
}

// Lê as conversas da conta na frente (WhatsApp ou Telegram) para o menu de destaques. Roda antes
// de esconder a página, porque a lista só aparece inteira com a página visível.
async function lerListaDaFrente() {
  listaFrente = null;
  const acc = activeId && accountById(activeId);
  if (!acc || !SERVICOS_COM_LISTA.includes(acc.service) || !tabs.has(activeId)) return;
  try {
    const nomes = await tabs.get(activeId).view.webContents.executeJavaScript(scriptLerLista(acc.service));
    if (Array.isArray(nomes) && nomes.length) listaFrente = { accountId: activeId, nomes };
  } catch {
    listaFrente = null;
  }
}

function selectTab(accountId) {
  const next = tabs.get(accountId);
  if (!next) return;
  // Todas as abas continuam anexadas à janela, só a da frente aparece. Se a aba for
  // removida da janela, o WhatsApp para de desenhar a lista e ela só volta ao abrir a aba.
  for (const entry of tabs.values()) {
    if (!win.contentView.children.includes(entry.view)) win.contentView.addChildView(entry.view);
  }
  win.contentView.removeChildView(next.view);
  win.contentView.addChildView(next.view); // a da frente fica por cima das outras
  activeId = accountId;
  bringUiToFront();
  layout();
  broadcast();
}

function closeTab(accountId) {
  const entry = tabs.get(accountId);
  if (entry) {
    win.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    tabs.delete(accountId);
  }
  state.openTabs = state.openTabs.filter((id) => id !== accountId);
  // Pop-ups temporários somem ao fechar.
  state.accounts = state.accounts.filter((a) => !(a.transient && a.id === accountId));
  saveState();
  if (activeId === accountId) {
    activeId = null;
    const fallback = state.openTabs[state.openTabs.length - 1];
    if (fallback) selectTab(fallback);
  }
  broadcast();
}

async function deleteAccount(accountId) {
  const acc = accountById(accountId);
  if (!acc) return;
  closeTab(accountId);
  state.accounts = state.accounts.filter((a) => a.id !== accountId);
  // Os destaques dessa conta somem junto (senão apontam para uma conta que não existe mais).
  state.favoritas = state.favoritas.filter((f) => f.accountId !== accountId);
  saveState();
  layout(); // se não sobrar destaque, a linha dos destaques some
  // Apaga os dados da conta (login, mensagens em cache). Irreversível.
  await session.fromPartition(acc.partition).clearStorageData();
  broadcast();
}

function createAccount(service) {
  if (!SERVICES[service]) throw new Error('serviço desconhecido');
  const id = crypto.randomUUID().slice(0, 8);
  const count = state.accounts.filter((a) => a.service === service && !a.transient).length + 1;
  const account = {
    id,
    service,
    name: `${SERVICES[service].label} ${count}`,
    partition: `persist:conta-${id}`,
  };
  state.accounts.push(account);
  saveState();
  return openAccount(id);
}

// Espera a página da conta terminar de carregar (no máximo 30 segundos) antes de procurar a conversa.
function esperarCarregamento(wc, limite = 30000) {
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, limite);
    wc.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function registerIpc() {
  registerGmIpc(scripts, { aoMudar: () => broadcast() });
  const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('state:get', () => snapshot());
  handle('account:new', (service) => createAccount(service));
  handle('account:open', (id) => openAccount(id));
  handle('account:delete', (id) => deleteAccount(id));
  handle('tab:select', (id) => selectTab(id));
  handle('tab:close', (id) => closeTab(id));
  // A página avisa (pela ponte preload-transcricao.js) que uma notificação foi clicada.
  ipcMain.on('conta:focar', (e) => {
    const id = [...tabs.keys()].find((k) => tabs.get(k).view.webContents.id === e.sender.id);
    if (!id || !win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    panelOpen = false;
    listaFrente = null;
    selectTab(id);
  });
  handle('tab:move', (id, destino) => {
    state.openTabs = moverAba(state.openTabs, id, destino);
    saveState();
    broadcast();
  });
  handle('menu:set', (open) => {
    menuOpen = !!open;
    layout();
  });
  handle('panel:set', async (open) => {
    panelOpen = !!open;
    if (panelOpen) await lerListaDaFrente();
    else listaFrente = null;
    layout();
    broadcast();
  });
  handle('tema:set', (tema) => {
    if (!TEMAS.includes(tema)) throw new Error('tema desconhecido');
    state.tema = tema;
    saveState();
    aplicarTemaNasContas();
    broadcast();
  });
  handle('account:rename', (id, nome) => {
    const acc = accountById(id);
    if (!acc) throw new Error('conta não encontrada');
    const texto = String(nome || '').trim().slice(0, 40);
    if (!texto) throw new Error('digite um nome para a conta');
    acc.name = texto;
    saveState();
    broadcast();
  });
  handle('fav:add', (accountId, nome) => {
    const texto = String(nome || '').trim().slice(0, 80);
    if (!texto) throw new Error('digite o nome da conversa');
    if (!accountById(accountId)) throw new Error('conta não encontrada');
    state.favoritas.push({ id: crypto.randomUUID().slice(0, 8), accountId, nome: texto });
    saveState();
    layout(); // a linha dos destaques pode ter aparecido agora
    broadcast();
  });
  handle('fav:remove', (id) => {
    state.favoritas = state.favoritas.filter((f) => f.id !== id);
    saveState();
    layout(); // se for o último destaque, a linha some
    broadcast();
  });
  // Arrastar um destaque na faixa: a ordem nova vale para a faixa e para Opções › Destaques.
  handle('fav:move', (id, destino) => {
    const ordem = moverAba(state.favoritas.map((f) => f.id), id, destino);
    state.favoritas = ordem.map((i) => state.favoritas.find((f) => f.id === i));
    saveState();
    broadcast();
  });
  handle('fav:open', async (id) => {
    const f = state.favoritas.find((x) => x.id === id);
    if (!f) throw new Error('destaque não encontrado');
    // Com Opções aberta, as abas ficam sem área (ver layout): fecha o painel antes, senão a conversa não aparece.
    panelOpen = false;
    listaFrente = null;
    layout();
    broadcast();
    const jaAberta = tabs.has(f.accountId);
    const acc = accountById(f.accountId);
    await openAccount(f.accountId);
    const entry = tabs.get(f.accountId);
    // Conta fechada: a página ainda está carregando. Sem esperar, a busca roda na página vazia e falha.
    if (!jaAberta) await esperarCarregamento(entry.view.webContents);
    const r = await entry.view.webContents.executeJavaScript(scriptAbrirConversa(acc.service, f.nome));
    if (r !== 'ok') throw new Error('conversa não está na lista carregada (role a lista e tente de novo)');
  });
  // Links da tela Créditos: só os da lista permitida, abertos no navegador do sistema.
  handle('link:abrir', (url) => {
    if (!linkPermitido(url)) throw new Error('endereço não permitido');
    return shell.openExternal(url);
  });
  // Botão "Preparar" em Opções › Transcrição. Roda em segundo plano; o progresso vai pelo snapshot.
  handle('transcricao:instalar', () => {
    if (instalacao.rodando) throw new Error('a preparação já está em andamento');
    instalacao = { rodando: true, etapa: '', texto: 'Preparando…', pct: null, erro: null };
    broadcast();
    instalador.instalar((avanco) => {
      instalacao = { ...instalacao, ...avanco };
      broadcast();
    }).then(() => {
      instalacao = { rodando: false, etapa: 'pronto', texto: 'Pronta para usar', pct: 1, erro: null };
    }).catch((err) => {
      instalacao = { rodando: false, etapa: 'erro', texto: '', pct: null, erro: err.message };
    }).finally(broadcast);
    return true;
  });

  // Pedido do botão "Transcrever" (vem da ponte preload-transcricao.js, do WhatsApp e do Telegram).
  ipcMain.handle('transcricao:pedir', async (event, pedido) => {
    const origem = event.senderFrame ? String(event.senderFrame.url || '') : '';
    if (!ORIGENS_TRANSCRICAO.some((o) => origem.startsWith(o))) {
      return { ok: false, erro: 'origem não permitida' };
    }
    // Texto parcial: a cada trecho de 15 s pronto, o app manda o texto até ali para a mesma página (só para exibir).
    const reqId = pedido && typeof pedido.reqId === 'string' && pedido.reqId.length <= 100 ? pedido.reqId : null;
    const frame = event.senderFrame;
    const onParcial = (texto) => {
      if (!reqId) return;
      try {
        frame.send('transcricao:parcial', { reqId, texto });
      } catch {
        // a página navegou ou fechou no meio: a transcrição segue até o fim
      }
    };
    try {
      const r = await transcricao.transcrever(pedido || {}, { onParcial });
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, erro: err.message };
    }
  });
  handle('script:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Escolha um userscript (.user.js)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Userscript', extensions: ['js'] }],
    });
    if (r.canceled) return;
    for (const arq of r.filePaths) scripts.add(fs.readFileSync(arq, 'utf8'));
    broadcast();
  });
  handle('script:toggle', (id, enabled) => {
    scripts.setEnabled(id, enabled);
    broadcast();
  });
  handle('script:remove', (id) => {
    scripts.remove(id);
    broadcast();
  });
  handle('dominios:adicionar', (dominio) => {
    const d = scripts.adicionarDominio(dominio);
    broadcast();
    return d;
  });
  handle('dominios:remover', (dominio) => {
    scripts.removerDominio(dominio);
    broadcast();
  });
  handle('script:comando', async (id) => {
    const entry = activeId && tabs.get(activeId);
    if (!entry) throw new Error('nenhuma aba aberta');
    await scripts.executarComando(entry.view.webContents, id);
  });
}

// Menu de aplicativos e barra de tarefas (Linux): o ícone e o atalho ficam no perfil do usuário.
// Os testes (DM_DATA_DIR, DM_SHOT) não mexem no sistema do computador.
function integrarAoSistema() {
  if (process.env.DM_DATA_DIR || process.env.DM_SHOT) return;
  try {
    const comando = process.env.APPIMAGE ? [process.env.APPIMAGE]
      : app.isPackaged ? [process.execPath]
        : [process.execPath, path.join(__dirname, '..')];
    integrarSistema({ icone: ARQUIVO_ICONE, comando });
  } catch (err) {
    console.warn('não consegui instalar o atalho do sistema:', err.message);
  }
}

function createWindow() {
  win = new BaseWindow({
    width: 1280,
    height: 820,
    title: 'Dual Messenger',
    icon: iconeDoApp(),
    backgroundColor: '#121212',
  });

  uiView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  uiView.setBackgroundColor('#00000000'); // transparente: a página aparece atrás do menu
  uiView.webContents.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  uiView.webContents.on('will-navigate', (e) => e.preventDefault());
  uiView.webContents.on('before-input-event', (event, input) => atalhoDaTecla(event, input));
  win.contentView.addChildView(uiView);

  win.on('resize', layout);
  win.on('closed', () => {
    win = null;
    uiView = null;
    tabs.clear();
  });
  layout();
}

// DM_DATA_DIR isola os dados do app (usado pelo teste de fumaça).
if (process.env.DM_DATA_DIR) app.setPath('userData', process.env.DM_DATA_DIR);
// Liga a janela ao atalho .desktop (Wayland e X11): é por ele que o sistema acha o ícone. Tem que vir antes do ready.
if (process.platform === 'linux') app.setDesktopName(`${ID_APP}.desktop`);
// No Windows, as notificações (toasts) só aparecem com o mesmo AppUserModelID do instalador (appId do package.json).
if (process.platform === 'win32') app.setAppUserModelId('local.dualmessenger.app');

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // sem a barra padrão do Electron (File, Edit, View…)
  integrarAoSistema(); // antes da janela: o GNOME precisa do atalho quando ela aparece
  scripts = new ScriptManager({ dataDir: app.getPath('userData'), appVersion: app.getVersion() });
  transcricao = criarServicoTranscricao({ dataDir: app.getPath('userData'), appDir: path.join(__dirname, '..') });
  instalador = criarInstalador({ dataDir: app.getPath('userData'), appDir: path.join(__dirname, '..') });
  state = readJson(statePath(), { accounts: [], openTabs: [], favoritas: [] });
  state.favoritas = state.favoritas || [];
  if (!TEMAS.includes(state.tema)) state.tema = 'auto';
  aplicarTemaNasContas();
  // Pop-ups temporários da sessão anterior não devem voltar.
  state.accounts = state.accounts.filter((a) => !a.transient);

  registerIpc();
  createWindow();

  // Reabre as abas que estavam abertas ao fechar o app.
  const toRestore = state.openTabs.filter((id) => accountById(id));
  state.openTabs = [];
  // Todas são carregadas já no início (sem trocar de aba); a primeira fica na frente.
  for (const id of toRestore) {
    try {
      await openAccount(id, false);
    } catch (err) {
      console.error('falha ao reabrir', id, err);
    }
  }
  if (state.openTabs.length) selectTab(state.openTabs[0]);

  // Gancho de teste visual (só com DM_SHOT): cria uma conta, opcionalmente abre o painel,
  // salva um print da barra e fecha.
  if (process.env.DM_SHOT) {
    await new Promise((r) => setTimeout(r, 1500));
    win.setContentSize(1280, 820); // headless começa com 1x1
    if (process.env.DM_SHOT_SERVICE) await createAccount(process.env.DM_SHOT_SERVICE);
    if (process.env.DM_SHOT_TEMA) {
      state.tema = process.env.DM_SHOT_TEMA;
      broadcast();
    }
    if (process.env.DM_SHOT_PANEL) {
      await lerListaDaFrente();
      panelOpen = true;
      layout();
      broadcast();
    }
    await new Promise((r) => setTimeout(r, 2500));
    if (process.env.DM_SHOT_FAVORITOS) {
      // N destaques de teste (para ver a linha com rolagem).
      await uiView.webContents.executeJavaScript(`(async () => {
        const conta = (await window.dm.getState()).value.accounts[0];
        for (let i = 1; i <= ${Number(process.env.DM_SHOT_FAVORITOS)}; i++) await window.dm.addFavorite(conta.id, 'Conversa ' + i);
      })()`);
      await new Promise((r) => setTimeout(r, 500));
    }
    if (process.env.DM_SHOT_ROLAR !== undefined) {
      // Clica N vezes na seta direita e mede a linha: setas visíveis, posição do primeiro e do último destaque.
      // Medidas em px a partir da borda da faixa (o primeiro tem que ficar em ~8 px no início).
      const medir = `(async () => {
        const cliques = ${Number(process.env.DM_SHOT_ROLAR) || 0};
        const t = document.getElementById('favoritas');
        const seta = document.getElementById('fav-dir');
        for (let i = 0; i < cliques; i++) { seta.click(); await new Promise((r) => setTimeout(r, 600)); }
        await new Promise((r) => setTimeout(r, 300));
        const faixa = document.getElementById('faixa-favoritas').getBoundingClientRect();
        const chips = t.querySelectorAll('.fav-chip');
        const primeiro = chips[0].getBoundingClientRect();
        const ultimo = chips[chips.length - 1].getBoundingClientRect();
        const visivel = (id) => !document.getElementById(id).classList.contains('hidden');
        return JSON.stringify({ seta_esq: visivel('fav-esq'), seta_dir: visivel('fav-dir'),
          rolagem: Math.round(t.scrollLeft), folga: t.scrollWidth - t.clientWidth, chips: chips.length,
          primeiro_da_borda: Math.round(primeiro.left - faixa.left), ultimo_da_borda: Math.round(faixa.right - ultimo.right) });
      })()`;
      console.log('faixa:', await uiView.webContents.executeJavaScript(medir));
    }
    if (process.env.DM_SHOT_FAVORITO) {
      // Botão Abrir de Destaques com Opções aberta. Sem login a conversa não existe: o esperado é o painel
      // fechar e o aviso de erro aparecer dentro da barra.
      await uiView.webContents.executeJavaScript(`(async () => {
        const conta = (await window.dm.getState()).value.accounts[0];
        await window.dm.addFavorite(conta.id, 'Conversa teste');
        const favorito = (await window.dm.getState()).value.favoritas[0];
        await chamar(window.dm.openFavorite(favorito.id));
      })()`);
      const entrada = tabs.get([...tabs.keys()][0]);
      console.log('destaque: painel aberto =', panelOpen, 'largura da aba =', entrada.view.getBounds().width);
      await new Promise((r) => setTimeout(r, 300));
    }
    if (process.env.DM_SHOT_PAGINA) {
      await uiView.webContents.executeJavaScript(`mostrarPagina(${JSON.stringify(process.env.DM_SHOT_PAGINA)})`);
      await new Promise((r) => setTimeout(r, 800)); // deixa a animação de entrada terminar
    }
    if (process.env.DM_SHOT_MENU) {
      await uiView.webContents.executeJavaScript('document.getElementById("btn-nova").click()');
      await new Promise((r) => setTimeout(r, 800));
    }
    if (process.env.DM_SHOT_CLICK_NOVA) {
      await uiView.webContents.executeJavaScript('document.querySelector("#menu-nova button").click()');
      await new Promise((r) => setTimeout(r, 5000));
    }
    const medida = await uiView.webContents.executeJavaScript(`(() => {
      const item = document.querySelector('#menu-nova button');
      if (!item) return 'sem item';
      const r = item.getBoundingClientRect();
      const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return JSON.stringify({ altura_janela: innerHeight, item_bottom: Math.round(r.bottom), item_visivel: r.bottom <= innerHeight, clicavel: topo === item || item.contains(topo) });
    })()`);
    console.log('medida do menu:', medida);
    const bounds = [...tabs.values()].map((e) => JSON.stringify(e.view.getBounds()));
    console.log('abas:', tabs.size, 'anexadas:', win.contentView.children.length, 'bounds:', [...new Set(bounds)].length, 'frente:', activeId);
    const diag = await uiView.webContents.executeJavaScript(
      'JSON.stringify({barra: document.getElementById("barra")?.offsetHeight, aba: document.querySelectorAll(".aba").length, chips: document.querySelectorAll(".fav-chip").length, favW: document.getElementById("favoritas") && document.getElementById("favoritas").getBoundingClientRect().width, vw: innerWidth, vh: innerHeight})'
    );
    console.log('diagnóstico da UI:', diag, 'bounds:', JSON.stringify(uiView.getBounds()));
    const img = await uiView.webContents.capturePage();
    console.log('tamanho da captura:', JSON.stringify(img.getSize()));
    fs.writeFileSync(process.env.DM_SHOT, img.toPNG());
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
