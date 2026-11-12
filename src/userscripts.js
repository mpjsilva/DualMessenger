'use strict';

// Leitura de userscripts (.user.js, formato do Tampermonkey/Greasemonkey)
// e casamento de URL com @match / @include / @exclude.

const HEADER_RE = /\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/;
// Chaves que podem aparecer várias vezes. @resource é "nome url"; @connect é um domínio ou '*'.
const MULTI_KEYS = ['match', 'include', 'exclude', 'grant', 'require', 'resource', 'connect'];

// Nomes do namespace GM.* (Tampermonkey) e das permissões GM_* equivalentes.
const GRANT_ALIAS = {
  'GM.getValue': 'GM_getValue',
  'GM.setValue': 'GM_setValue',
  'GM.deleteValue': 'GM_deleteValue',
  'GM.listValues': 'GM_listValues',
  'GM.addStyle': 'GM_addStyle',
  'GM.log': 'GM_log',
  'GM.notification': 'GM_notification',
  'GM.xmlHttpRequest': 'GM_xmlhttpRequest',
  'GM.openInTab': 'GM_openInTab',
  'GM.setClipboard': 'GM_setClipboard',
  'GM.getResourceUrl': 'GM_getResourceURL',
  'GM.getResourceText': 'GM_getResourceText',
  'GM.registerMenuCommand': 'GM_registerMenuCommand',
  'GM.unregisterMenuCommand': 'GM_unregisterMenuCommand',
  'GM.addElement': 'GM_addElement',
  'GM.addValueChangeListener': 'GM_addValueChangeListener',
  'GM.removeValueChangeListener': 'GM_removeValueChangeListener',
};

function normalizarGrant(g) {
  return GRANT_ALIAS[g] || g;
}

function parseHeader(source) {
  const m = String(source).match(HEADER_RE);
  if (!m) throw new Error('userscript sem bloco ==UserScript==');
  const meta = { match: [], include: [], exclude: [], grant: [], require: [], resource: [], connect: [], runAt: 'document-end', noframes: false };
  for (const line of m[1].split(/\r?\n/)) {
    const lm = line.match(/^\s*\/\/\s*@(\S+)\s*(.*)$/);
    if (!lm) continue;
    const key = lm[1].toLowerCase();
    const value = lm[2].trim();
    if (key === 'run-at') meta.runAt = value || 'document-end';
    else if (key === 'noframes') meta.noframes = true;
    else if (MULTI_KEYS.includes(key)) {
      if (value) meta[key].push(value);
    } else if (!(key in meta)) meta[key] = value;
  }
  meta.grant = meta.grant.map(normalizarGrant);
  if (!meta.name) throw new Error('userscript sem @name');
  return meta;
}

// Permissões do script, já normalizadas (também para scripts instalados antes desta versão).
function grantsDe(meta) {
  return (meta.grant || []).map(normalizarGrant);
}

// Host de uma URL, em minúsculas; null se não for uma URL válida.
function hostDe(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Verdadeiro se o host for o domínio cadastrado ou um subdomínio dele (cdn.jsdelivr.net casa com a.cdn.jsdelivr.net).
function hostCasa(host, dominio) {
  return !!host && !!dominio && (host === dominio || host.endsWith('.' + dominio));
}

// Aceita "cdn.jsdelivr.net", "*.jsdelivr.net" ou uma URL; devolve só o host, ou null se inválido.
function normalizarDominio(texto) {
  const s = String(texto || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .split('/')[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// Converte um padrão de @match (esquema://host/caminho) em RegExp.
// Ex.: https://web.whatsapp.com/* ; *://*.telegram.org/*
function matchPatternToRegExp(pattern) {
  const m = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]*)\/(.*)$/);
  if (!m) return null;
  const [, scheme, host, path] = m;
  const schemeRe = scheme === '*' ? 'https?' : escapeRe(scheme);
  let hostRe;
  if (host === '*') hostRe = '[^/]*';
  else if (host.startsWith('*.')) hostRe = `(?:[^/]*\\.)?${escapeRe(host.slice(2))}`;
  else hostRe = escapeRe(host);
  const pathRe = path.split('*').map(escapeRe).join('.*');
  return new RegExp(`^${schemeRe}://${hostRe}/${pathRe}$`);
}

// @include aceita glob simples (* curinga) ou /regex/.
function includeToRegExp(pattern) {
  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    return new RegExp(pattern.slice(1, -1));
  }
  return new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`);
}

function urlMatches(meta, url) {
  const any = (list, convert) => list.some((p) => {
    const re = convert(p);
    return re !== null && re.test(url);
  });
  if (any(meta.exclude, includeToRegExp)) return false;
  return any(meta.match, matchPatternToRegExp) || any(meta.include, includeToRegExp);
}

module.exports = {
  parseHeader, matchPatternToRegExp, includeToRegExp, urlMatches,
  normalizarGrant, grantsDe, hostDe, hostCasa, normalizarDominio, GRANT_ALIAS,
};
