'use strict';

// Integração com a área de trabalho Linux (menu de aplicativos, dock, barra de tarefas).
// Grava o ícone e um atalho .desktop no perfil do usuário, sem senha.
// O nome do atalho é o mesmo do appId (package.json): é por ele que o GNOME liga a janela ao atalho.
// Só reescreve os arquivos quando o conteúdo muda.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ID_APP = 'local.dualmessenger.app';

// O Exec do atalho tem dois níveis de escape. Primeiro o do argumento: aspas, \, `, $ ganham uma \
// e o argumento vai entre aspas. Depois o do arquivo: toda \ vira \\. O % é campo do lançador: vira %%.
function escaparArgumento(texto) {
  const doArgumento = texto.replace(/(["`$\\])/g, '\\$1');
  const doArquivo = doArgumento.replace(/\\/g, '\\\\');
  return `"${doArquivo.replace(/%/g, '%%')}"`;
}

function conteudoDoAtalho({ comando, icone }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Dual Messenger',
    'Comment=WhatsApp Web e Telegram Web em abas isoladas',
    `Exec=${comando.map(escaparArgumento).join(' ')}`,
    `Icon=${icone}`,
    'Terminal=false',
    'Categories=Network;InstantMessaging;',
    `StartupWMClass=${ID_APP}`,
    'StartupNotify=true',
    '',
  ].join('\n');
}

// Grava só se o conteúdo for diferente. Devolve true quando gravou.
function gravarSeMudou(arquivo, conteudo) {
  const novo = Buffer.from(conteudo);
  try {
    if (Buffer.compare(fs.readFileSync(arquivo), novo) === 0) return false;
  } catch {
    // ainda não existe
  }
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const temp = `${arquivo}.tmp`;
  fs.writeFileSync(temp, novo, { mode: 0o644 });
  fs.renameSync(temp, arquivo);
  return true;
}

// Instala ou atualiza o ícone e o atalho. comando é a lista de argumentos do Exec.
// Devolve true se gravou algo. Falhas sobem como erro: quem chama decide o que mostrar.
function integrarSistema({ icone, comando, home = os.homedir(), dataHome = process.env.XDG_DATA_HOME }) {
  if (process.platform !== 'linux') return false;
  const base = dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, '.local', 'share');
  const arquivoIcone = path.join(base, 'icons', `${ID_APP}.png`);
  const atalho = path.join(base, 'applications', `${ID_APP}.desktop`);
  const gravouIcone = gravarSeMudou(arquivoIcone, fs.readFileSync(icone));
  const gravouAtalho = gravarSeMudou(atalho, conteudoDoAtalho({ comando, icone: arquivoIcone }));
  return gravouIcone || gravouAtalho;
}

module.exports = { integrarSistema, escaparArgumento, ID_APP };
