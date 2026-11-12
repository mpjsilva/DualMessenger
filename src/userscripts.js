'use strict';

// Leitura de userscripts (.user.js, formato do Tampermonkey/Greasemonkey)
// e casamento de URL com @match / @include / @exclude.

const HEADER_RE = /\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/;
const MULTI_KEYS = ['match', 'include', 'exclude', 'grant'];

function parseHeader(source) {
  const m = String(source).match(HEADER_RE);
  if (!m) throw new Error('userscript sem bloco ==UserScript==');
  const meta = { match: [], include: [], exclude: [], grant: [], runAt: 'document-end' };
  for (const line of m[1].split(/\r?\n/)) {
    const lm = line.match(/^\s*\/\/\s*@(\S+)\s*(.*)$/);
    if (!lm) continue;
    const key = lm[1].toLowerCase();
    const value = lm[2].trim();
    if (key === 'run-at') meta.runAt = value || 'document-end';
    else if (MULTI_KEYS.includes(key)) meta[key].push(value);
    else if (!(key in meta)) meta[key] = value;
  }
  if (!meta.name) throw new Error('userscript sem @name');
  return meta;
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

module.exports = { parseHeader, matchPatternToRegExp, includeToRegExp, urlMatches };
