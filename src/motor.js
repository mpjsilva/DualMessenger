'use strict';

// Executor de userscripts: guarda os scripts importados, injeta em cada aba os que
// combinam com a URL e atende a API GM_* (valores, requisições, notificações, menus).
//
// Segurança: o bridge GM fica exposto na página, então toda chamada precisa de um
// token aleatório por script (só o código injetado conhece). Sem token ou sem o
// @grant correspondente, a chamada é recusada. @require e @resource só são baixados
// de domínios que o usuário cadastrou (dominios.json).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  parseHeader, urlMatches, grantsDe, hostDe, hostCasa, normalizarDominio,
} = require('./userscripts');
const { readJson, writeJsonAtomic } = require('./store');

const GRANTS_GM = {
  GM_getValue: `function GM_getValue(k, d) { return __dmGM().getValue(__dmT, k, d); }`,
  GM_setValue: `function GM_setValue(k, v) {
    var antigo; try { antigo = __dmGM().getValue(__dmT, k); } catch (e) {}
    __dmGM().setValue(__dmT, k, v); __dmNotificar(k, antigo, v);
  }`,
  GM_deleteValue: `function GM_deleteValue(k) { return __dmGM().deleteValue(__dmT, k); }`,
  GM_listValues: `function GM_listValues() { return __dmGM().listValues(__dmT); }`,
  GM_addValueChangeListener: `function GM_addValueChangeListener(nome, fn) {
    var id = ++__dmContador; __dmOuvintes.push({ id: id, nome: nome, fn: fn }); return id;
  }`,
  GM_removeValueChangeListener: `function GM_removeValueChangeListener(id) {
    __dmOuvintes = __dmOuvintes.filter(function (o) { return o.id !== id; });
  }`,
  GM_log: `function GM_log() { console.log.apply(console, ['[userscript]'].concat([].slice.call(arguments))); }`,
  GM_addStyle: `function GM_addStyle(css) {
    var s = document.createElement('style'); s.textContent = css;
    (document.head || document.documentElement).appendChild(s); return s;
  }`,
  GM_addElement: `function GM_addElement(a, b, c) {
    var pai, tag, attrs;
    if (typeof a === 'string') { tag = a; attrs = b || {}; pai = document.head || document.documentElement; }
    else { pai = a; tag = b; attrs = c || {}; }
    var el = document.createElement(tag);
    Object.keys(attrs).forEach(function (k) {
      if (k === 'textContent' || k === 'innerHTML') el[k] = attrs[k]; else el.setAttribute(k, attrs[k]);
    });
    pai.appendChild(el); return el;
  }`,
  GM_getResourceURL: `function GM_getResourceURL(nome) { var r = __dmRec[nome]; return r ? r.url : undefined; }`,
  GM_getResourceText: `function GM_getResourceText(nome) { var r = __dmRec[nome]; return r ? r.texto : undefined; }`,
  GM_notification: `function GM_notification(opts, ondone) {
    if (typeof opts === 'string') opts = { text: opts };
    return __dmGM().notification(__dmT, opts || {});
  }`,
  GM_openInTab: `function GM_openInTab(url) { return __dmGM().abrir(__dmT, String(url)); }`,
  GM_setClipboard: `function GM_setClipboard(texto) { return __dmGM().copiar(__dmT, String(texto)); }`,
  GM_registerMenuCommand: `function GM_registerMenuCommand(nome, fn) {
    var n = __dmGM().menu(__dmT, String(nome));
    window.__dmMenu = window.__dmMenu || {}; window.__dmMenu[n] = fn; return n;
  }`,
  GM_unregisterMenuCommand: `function GM_unregisterMenuCommand(n) {
    __dmGM().menuRemover(__dmT, n); if (window.__dmMenu) delete window.__dmMenu[n];
  }`,
  GM_xmlhttpRequest: `function GM_xmlhttpRequest(details) {
    var ok = function (r) { if (details.onload) details.onload(r); };
    var falha = function (e) { if (details.onerror) details.onerror({ error: String(e && e.message || e) }); };
    __dmGM().xhr(__dmT, {
      method: details.method || 'GET', url: details.url,
      headers: details.headers || {}, data: details.data || null,
    }).then(ok, falha);
    return { abort: function () {} };
  }`,
};

// Nome no namespace GM.* (Tampermonkey, assíncrono) de cada GM_* concedido.
const NOME_GM = {
  GM_getValue: 'getValue', GM_setValue: 'setValue', GM_deleteValue: 'deleteValue',
  GM_listValues: 'listValues', GM_addValueChangeListener: 'addValueChangeListener',
  GM_removeValueChangeListener: 'removeValueChangeListener', GM_log: 'log', GM_addStyle: 'addStyle',
  GM_addElement: 'addElement', GM_getResourceURL: 'getResourceUrl', GM_getResourceText: 'getResourceText',
  GM_notification: 'notification', GM_openInTab: 'openInTab', GM_setClipboard: 'setClipboard',
  GM_registerMenuCommand: 'registerMenuCommand', GM_unregisterMenuCommand: 'unregisterMenuCommand',
  GM_xmlhttpRequest: 'xmlHttpRequest',
};

// Envolve o script para que um erro nele não derrube a página nem os outros scripts.
function envolver(codigo, nome, shim = '') {
  return `(function () {\ntry {\n${shim}\n${codigo}\n} catch (e) {\n  console.error('[userscript ' + ${JSON.stringify(nome)} + ']', e);\n}\n})();`;
}

class ScriptManager {
  constructor({ dataDir, appVersion = '' }) {
    this.dir = path.join(dataDir, 'userscripts');
    this.indice = path.join(this.dir, 'indice.json');
    this.valoresArq = path.join(this.dir, 'valores.json');
    this.dominiosArq = path.join(this.dir, 'dominios.json');
    this.cacheDir = path.join(this.dir, 'cache');
    this.appVersion = appVersion;
    this.items = readJson(this.indice, []);
    this.valores = readJson(this.valoresArq, {});
    this.dominios = readJson(this.dominiosArq, []);
    this.tokens = new Map(); // id -> token (só nesta execução)
    this.porToken = new Map(); // token -> id
    this.erros = new Map(); // id -> motivo da última falha ao injetar
    this.menus = new Map(); // id da aba -> [{ id, nome, script }]
    this.menuSeq = 0;
  }

  save() {
    writeJsonAtomic(this.indice, this.items);
  }

  list() {
    return this.items.map((i) => ({
      id: i.id, name: i.name, version: i.version, enabled: i.enabled, erro: this.erros.get(i.id) || null,
    }));
  }

  // Recebe o texto de um .user.js, valida o cabeçalho e guarda uma cópia no app.
  add(texto) {
    const meta = parseHeader(texto);
    const id = crypto.createHash('sha1').update(texto).digest('hex').slice(0, 12);
    if (this.items.some((i) => i.id === id)) throw new Error('esse script já está instalado');
    fs.mkdirSync(this.dir, { recursive: true });
    const arquivo = path.join(this.dir, `${id}.user.js`);
    fs.writeFileSync(arquivo, texto);
    this.items.push({
      id,
      name: meta.name,
      version: meta.version || '',
      enabled: true,
      arquivo,
      meta,
    });
    this.save();
    return id;
  }

  setEnabled(id, enabled) {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error('script não encontrado');
    item.enabled = !!enabled;
    this.save();
  }

  remove(id) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
    fs.rmSync(item.arquivo, { force: true });
    delete this.valores[id];
    writeJsonAtomic(this.valoresArq, this.valores);
  }

  // ---- domínios permitidos para @require, @resource ----

  listarDominios() {
    return [...this.dominios];
  }

  adicionarDominio(texto) {
    const d = normalizarDominio(texto);
    if (!d) throw new Error('domínio inválido (ex.: cdn.jsdelivr.net)');
    if (!this.dominios.includes(d)) {
      this.dominios.push(d);
      writeJsonAtomic(this.dominiosArq, this.dominios);
    }
    return d;
  }

  removerDominio(dominio) {
    this.dominios = this.dominios.filter((d) => d !== dominio);
    writeJsonAtomic(this.dominiosArq, this.dominios);
  }

  dominioPermitido(url) {
    const host = hostDe(url);
    return !!host && this.dominios.some((d) => hostCasa(host, d));
  }

  // Baixa um recurso (com cache em disco). Recusa domínio não cadastrado, inclusive após redirecionamento.
  async baixar(url) {
    if (!this.dominioPermitido(url)) {
      throw new Error(`domínio não permitido: ${hostDe(url) || url}. Cadastre-o em Opções › Userscripts`);
    }
    const arq = path.join(this.cacheDir, crypto.createHash('sha256').update(url).digest('hex'));
    if (fs.existsSync(arq)) return fs.readFileSync(arq);
    const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
    if (!this.dominioPermitido(resp.url)) {
      throw new Error(`redirecionamento para domínio não permitido: ${hostDe(resp.url)}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(arq, buf);
    return buf;
  }

  // @require (código, na ordem do cabeçalho) e @resource (nome -> texto e URL data:).
  async montarRecursos(item) {
    const meta = item.meta;
    const requires = [];
    for (const url of meta.require || []) requires.push((await this.baixar(url)).toString('utf8'));
    const resources = {};
    for (const linha of meta.resource || []) {
      const m = linha.match(/^(\S+)\s+(\S+)$/);
      if (!m) continue;
      const buf = await this.baixar(m[2]);
      resources[m[1]] = { texto: buf.toString('utf8'), url: `data:application/octet-stream;base64,${buf.toString('base64')}` };
    }
    return { requires: requires.join('\n;\n'), resources };
  }

  // Scripts habilitados que combinam com a URL.
  paraUrl(url) {
    return this.items.filter((i) => i.enabled && urlMatches(i.meta, url));
  }

  tokenFor(id) {
    if (!this.tokens.has(id)) {
      const token = crypto.randomBytes(16).toString('hex');
      this.tokens.set(id, token);
      this.porToken.set(token, id);
    }
    return this.tokens.get(id);
  }

  // Preâmbulo do script: sempre define unsafeWindow, GM_info e GM; o resto é só o que foi concedido.
  shim(item, recursos = { requires: '', resources: {} }) {
    const meta = item.meta;
    const grants = grantsDe(meta);
    const token = this.tokenFor(item.id);
    const info = {
      scriptHandler: 'Dual Messenger',
      version: this.appVersion,
      script: {
        name: item.name,
        version: item.version || '',
        author: meta.author || '',
        description: meta.description || '',
        namespace: meta.namespace || '',
        matches: meta.match || [],
        includes: meta.include || [],
        excludes: meta.exclude || [],
        grants,
        requires: meta.require || [],
        connects: meta.connect || [],
        resources: (meta.resource || []).map((l) => l.split(/\s+/)[0]),
        runAt: meta.runAt || 'document-end',
        noframes: !!meta.noframes,
      },
    };
    const partes = [
      `var __dmT = ${JSON.stringify(token)};`,
      `var __dmGM = function () { if (!window.__dmGM) throw new Error('API GM indisponível nesta página'); return window.__dmGM; };`,
      `var unsafeWindow = window;`,
      `var GM_info = ${JSON.stringify(info)};`,
      `var __dmRec = ${JSON.stringify(recursos.resources || {})};`,
      `var __dmOuvintes = []; var __dmContador = 0;`,
      `var __dmNotificar = function (nome, antigo, novo) {
        __dmOuvintes.slice().forEach(function (o) {
          if (o.nome === nome) { try { o.fn(nome, antigo, novo, false); } catch (e) { console.error(e); } }
        });
      };`,
      `var GM = { info: GM_info };`,
    ];
    for (const g of grants) {
      if (GRANTS_GM[g]) partes.push(GRANTS_GM[g]);
    }
    for (const g of grants) {
      const nome = NOME_GM[g];
      if (nome && GRANTS_GM[g]) {
        partes.push(`GM.${nome} = function () { var a = arguments; return new Promise(function (r) { r(${g}.apply(null, a)); }); };`);
      }
    }
    if (recursos.requires) partes.push(recursos.requires);
    return partes.join('\n');
  }

  // Injeta na página atual os scripts que combinam com a URL.
  // Devolve os nomes injetados. Um script que falha (ex.: @require de domínio não cadastrado) fica com erro.
  async injetar(webContents) {
    const url = webContents.getURL();
    this.limparMenus(webContents.id);
    const injetados = [];
    for (const item of this.paraUrl(url)) {
      try {
        const recursos = await this.montarRecursos(item);
        const codigo = fs.readFileSync(item.arquivo, 'utf8');
        await webContents.executeJavaScript(envolver(codigo, item.name, this.shim(item, recursos)));
        this.erros.delete(item.id);
        injetados.push(item.name);
      } catch (err) {
        this.erros.set(item.id, err.message);
        console.error(`[motor] falha ao injetar "${item.name}":`, err.message);
      }
    }
    return injetados;
  }

  // ---- API chamada pelo processo principal (IPC), sempre com token ----

  resolver(token) {
    const id = this.porToken.get(token);
    const item = id && this.items.find((i) => i.id === id);
    if (!item) throw new Error('chamada GM sem token válido');
    return item;
  }

  exigir(token, grant) {
    const item = this.resolver(token);
    if (!grantsDe(item.meta).includes(grant)) {
      throw new Error(`o script "${item.name}" não pede @grant ${grant}`);
    }
    return item;
  }

  getValue(token, chave, padrao) {
    const item = this.exigir(token, 'GM_getValue');
    const v = (this.valores[item.id] || {})[chave];
    return v === undefined ? padrao : v;
  }

  setValue(token, chave, valor) {
    const item = this.exigir(token, 'GM_setValue');
    this.valores[item.id] = this.valores[item.id] || {};
    this.valores[item.id][chave] = valor;
    writeJsonAtomic(this.valoresArq, this.valores);
  }

  deleteValue(token, chave) {
    const item = this.exigir(token, 'GM_deleteValue');
    if (this.valores[item.id]) delete this.valores[item.id][chave];
    writeJsonAtomic(this.valoresArq, this.valores);
  }

  listValues(token) {
    const item = this.exigir(token, 'GM_listValues');
    return Object.keys(this.valores[item.id] || {});
  }

  // GM_xmlhttpRequest: a requisição sai do processo principal, sem bloqueio de CORS.
  // Se o script declarou @connect, só os hosts declarados (ou '*') são aceitos.
  async xhr(token, opts) {
    const item = this.exigir(token, 'GM_xmlhttpRequest');
    const url = new URL(String(opts.url));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('GM_xmlhttpRequest aceita só http e https');
    }
    const conecta = (item.meta.connect || []).map((c) => c.toLowerCase().replace(/^\*\./, ''));
    if (conecta.length && !conecta.includes('*') && !conecta.some((c) => hostCasa(url.hostname.toLowerCase(), c))) {
      throw new Error(`o script não declarou @connect para ${url.hostname}`);
    }
    const resp = await fetch(url, {
      method: String(opts.method || 'GET').toUpperCase(),
      headers: opts.headers || {},
      body: opts.data || undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    const responseHeaders = [...resp.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
    return {
      status: resp.status,
      statusText: resp.statusText,
      finalUrl: resp.url,
      responseHeaders,
      responseText: await resp.text(),
    };
  }

  notification(token, opts) {
    this.exigir(token, 'GM_notification');
    return { ok: true, title: opts.title || '', text: opts.text || '' };
  }

  // GM_openInTab: devolve a URL validada; quem abre é o processo principal (navegador do sistema).
  abrirUrl(token, url) {
    this.exigir(token, 'GM_openInTab');
    let u;
    try {
      u = new URL(String(url));
    } catch {
      throw new Error('URL inválida');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('GM_openInTab aceita só http e https');
    return u.href;
  }

  // ---- comandos de menu (GM_registerMenuCommand), por aba ----

  registrarMenu(token, nome, wcId) {
    const item = this.exigir(token, 'GM_registerMenuCommand');
    const id = ++this.menuSeq;
    const lista = this.menus.get(wcId) || [];
    lista.push({ id, nome: String(nome).slice(0, 120), script: item.name });
    this.menus.set(wcId, lista);
    return id;
  }

  removerMenu(token, id, wcId) {
    this.exigir(token, 'GM_unregisterMenuCommand');
    const n = Number(id);
    this.menus.set(wcId, (this.menus.get(wcId) || []).filter((m) => m.id !== n));
  }

  comandosDaAba(wcId) {
    return (this.menus.get(wcId) || []).map((m) => ({ id: m.id, nome: m.nome, script: m.script }));
  }

  limparMenus(wcId) {
    this.menus.delete(wcId);
  }

  async executarComando(webContents, id) {
    const n = Number(id);
    const m = (this.menus.get(webContents.id) || []).find((x) => x.id === n);
    if (!m) throw new Error('comando não encontrado nesta aba');
    await webContents.executeJavaScript(
      `(function () { var f = window.__dmMenu && window.__dmMenu[${n}]; if (typeof f === 'function') f(); return null; })()`,
    );
  }
}

module.exports = { ScriptManager, envolver, GRANTS_GM, NOME_GM };
