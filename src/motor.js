'use strict';

// Executor de userscripts: guarda os scripts importados, injeta em cada aba os que
// combinam com a URL e atende a API GM_* (valores, requisições, notificações).
//
// Segurança: o bridge GM fica exposto na página, então toda chamada precisa de um
// token aleatório por script (só o código injetado conhece). Sem token ou sem o
// @grant correspondente, a chamada é recusada.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseHeader, urlMatches } = require('./userscripts');
const { readJson, writeJsonAtomic } = require('./store');

const GRANTS_GM = {
  GM_getValue: `function GM_getValue(k, d) { return __dmGM().getValue(__dmT, k, d); }`,
  GM_setValue: `function GM_setValue(k, v) { return __dmGM().setValue(__dmT, k, v); }`,
  GM_deleteValue: `function GM_deleteValue(k) { return __dmGM().deleteValue(__dmT, k); }`,
  GM_listValues: `function GM_listValues() { return __dmGM().listValues(__dmT); }`,
  GM_log: `function GM_log() { console.log.apply(console, ['[userscript]'].concat([].slice.call(arguments))); }`,
  GM_addStyle: `function GM_addStyle(css) {
    var s = document.createElement('style'); s.textContent = css;
    (document.head || document.documentElement).appendChild(s); return s;
  }`,
  GM_notification: `function GM_notification(opts, ondone) {
    if (typeof opts === 'string') opts = { text: opts };
    return __dmGM().notification(__dmT, opts);
  }`,
  GM_xmlhttpRequest: `function GM_xmlhttpRequest(details) {
    var ok = function (r) { if (details.onload) details.onload(r); };
    var falha = function (e) { if (details.onerror) details.onerror({ error: String(e && e.message || e) }); };
    return __dmGM().xhr(__dmT, {
      method: details.method || 'GET', url: details.url,
      headers: details.headers || {}, data: details.data || null,
    }).then(ok, falha);
  }`,
};

// Envolve o script para que um erro nele não derrube a página nem os outros scripts.
function envolver(codigo, nome, shim = '') {
  return `(function () {\ntry {\n${shim}\n${codigo}\n} catch (e) {\n  console.error('[userscript ' + ${JSON.stringify(nome)} + ']', e);\n}\n})();`;
}

class ScriptManager {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'userscripts');
    this.indice = path.join(this.dir, 'indice.json');
    this.valoresArq = path.join(this.dir, 'valores.json');
    this.items = readJson(this.indice, []);
    this.valores = readJson(this.valoresArq, {});
    this.tokens = new Map(); // id -> token (só nesta execução)
    this.porToken = new Map(); // token -> id
  }

  save() {
    writeJsonAtomic(this.indice, this.items);
  }

  list() {
    return this.items.map((i) => ({ id: i.id, name: i.name, version: i.version, enabled: i.enabled }));
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
      meta: { match: meta.match, include: meta.include, exclude: meta.exclude, grant: meta.grant },
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

  // Código de preâmbulo: define só as funções GM_* concedidas pelo @grant.
  shim(item) {
    const grants = item.meta.grant || [];
    if (grants.length === 0 || grants.includes('none')) return '';
    const token = this.tokenFor(item.id);
    const partes = [
      `var __dmT = ${JSON.stringify(token)};`,
      `var __dmGM = function () { if (!window.__dmGM) throw new Error('API GM indisponível nesta página'); return window.__dmGM; };`,
      `var GM_info = { scriptHandler: 'Dual Messenger', script: { name: ${JSON.stringify(item.name)}, version: ${JSON.stringify(item.version)} } };`,
    ];
    for (const g of grants) {
      if (GRANTS_GM[g]) partes.push(GRANTS_GM[g]);
    }
    return partes.join('\n');
  }

  // Injeta na página atual os scripts que combinam com a URL.
  // Devolve os nomes injetados (útil para teste e para o painel).
  async injetar(webContents) {
    const url = webContents.getURL();
    const injetados = [];
    for (const item of this.paraUrl(url)) {
      const codigo = fs.readFileSync(item.arquivo, 'utf8');
      try {
        await webContents.executeJavaScript(envolver(codigo, item.name, this.shim(item)));
        injetados.push(item.name);
      } catch (err) {
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
    if (!(item.meta.grant || []).includes(grant)) {
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
  async xhr(token, opts) {
    this.exigir(token, 'GM_xmlhttpRequest');
    const url = new URL(String(opts.url));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('GM_xmlhttpRequest aceita só http e https');
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
}

module.exports = { ScriptManager, envolver, GRANTS_GM };
