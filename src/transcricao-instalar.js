'use strict';

// Prepara a transcrição dentro do próprio app (botão em Opções › Transcrição).
// Linux: instala as ferramentas que faltam (pedindo a senha pela janela do sistema),
// compila o whisper.cpp, baixa o modelo e grava transcricao.json.
// Windows: baixa binários prontos (whisper-cli.exe e ffmpeg.exe), confere o SHA-256 de cada zip,
// extrai só o necessário e baixa o modelo. Nada é compilado.
// Tudo fica na pasta de dados do app. Quem já tiver algo pronto não baixa de novo.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { spawn, spawnSync } = require('node:child_process');
const { MODELO_PADRAO } = require('./transcricao-config');
const { writeJsonAtomic } = require('./store');

const URL_WHISPER = 'https://github.com/ggml-org/whisper.cpp.git';
const URL_MODELO = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';
const MODELO_MINIMO = 400 * 1000 * 1000; // ggml-small tem ~488 MB; sem tamanho informado, menos que isso é incompleto

// Binários do Windows (x64), fixados em versão. O SHA-256 é o do arquivo oficial publicado no GitHub.
// whisper.cpp v1.8.2 é a última release com binário pronto para Windows (a v1.9.x só traz código-fonte).
// FFmpeg: build LGPL compartilhada da série 8.1 (BtbN/FFmpeg-Builds).
const FONTES_WINDOWS = {
  whisper: {
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip',
    sha256: 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732',
  },
  ffmpeg: {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-12-15-40/ffmpeg-n8.1.3-35-gf1acb0a266-win64-lgpl-shared-8.1.zip',
    sha256: 'bb6eedd1978549c84e8dff7b72c885df090db6a6ee1de44e76c8855babea495c',
  },
};

// Visual C++ (MSVCP140, VCRUNTIME140, VCRUNTIME140_1): o whisper-cli.exe precisa delas, e nem todo Windows as tem.
// Usa o instalador oficial da Microsoft (aka.ms); no Windows, a assinatura digital é conferida antes de rodar.
const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const DLLS_VC = ['MSVCP140.dll', 'VCRUNTIME140.dll', 'VCRUNTIME140_1.dll'];

function vcRuntimeInstalado(sistema = process.env.SystemRoot || 'C:\\Windows') {
  return DLLS_VC.every((dll) => fs.existsSync(path.join(sistema, 'System32', dll)));
}

const aspas = (texto) => `'${String(texto).replace(/'/g, "''")}'`;

async function garantirVCRuntime(ferramentas, aoProgresso) {
  if (vcRuntimeInstalado()) return;
  fs.mkdirSync(ferramentas, { recursive: true });
  const exe = path.join(ferramentas, 'vc_redist.x64.exe');
  // Sem hash fixo: a Microsoft atualiza esse instalador. A garantia é a assinatura, conferida abaixo.
  await baixarVerificado(VC_REDIST_URL, exe, null, aoProgresso);
  const assinado = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `$s = Get-AuthenticodeSignature -LiteralPath ${aspas(exe)}; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -like '*Microsoft*') { exit 0 } else { exit 2 }`],
  { stdio: 'ignore' });
  if (assinado.status !== 0) {
    fs.rmSync(exe, { force: true });
    throw new Error('o instalador do Visual C++ não tem assinatura válida da Microsoft');
  }
  // Pede permissão de administrador (UAC) e instala em silêncio.
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `$p = Start-Process -FilePath ${aspas(exe)} -ArgumentList '/install','/quiet','/norestart' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`],
  { stdio: 'ignore' });
  fs.rmSync(exe, { force: true });
  if (!vcRuntimeInstalado()) {
    throw new Error(`não consegui instalar o Visual C++ (código ${r.status}); instale o Microsoft Visual C++ Redistributable x64 e tente de novo`);
  }
}

// Ferramentas do sistema e o pacote Fedora que as fornece (só Linux).
const FERRAMENTAS = [
  { cmd: 'git', args: ['--version'], pacote: 'git' },
  { cmd: 'cmake', args: ['--version'], pacote: 'cmake' },
  { cmd: 'g++', args: ['--version'], pacote: 'gcc-c++' },
  { cmd: 'ffmpeg', args: ['-version'], pacote: 'ffmpeg' },
];

function caminhos(dataDir, appDir, plataforma = process.platform) {
  const whisperDir = path.join(dataDir, 'whisper.cpp');
  const ferramentas = path.join(dataDir, 'ferramentas');
  const win = plataforma === 'win32';
  return {
    whisperDir,
    buildDir: path.join(whisperDir, 'build'),
    whisperBin: win
      ? path.join(ferramentas, 'whisper', 'whisper-cli.exe')
      : path.join(whisperDir, 'build', 'bin', 'whisper-cli'),
    modelo: path.join(dataDir, 'modelos', MODELO_PADRAO),
    ffmpegDoProjeto: win
      ? path.join(ferramentas, 'ffmpeg', 'ffmpeg.exe')
      : path.join(appDir, 'vendor', 'bin', 'ffmpeg'),
    ferramentas,
    config: path.join(dataDir, 'transcricao.json'),
  };
}

function temFerramenta(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

// Roda um comando e repassa as linhas de saída (para mostrar o progresso).
function rodar(cmd, args, { cwd, aoLinha } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let ultima = '';
    const ler = (dados) => {
      for (const linha of String(dados).split(/\r?\n/)) {
        if (!linha.trim()) continue;
        ultima = linha.trim();
        if (aoLinha) aoLinha(ultima);
      }
    };
    proc.stdout.on('data', ler);
    proc.stderr.on('data', ler);
    proc.on('error', (err) => reject(new Error(`${cmd} não pôde ser executado (${err.code || err.message})`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} falhou (código ${code})${ultima ? `: ${ultima.slice(-200)}` : ''}`));
    });
  });
}

// Baixa o modelo para um arquivo temporário e só então dá o nome final (download pela metade não conta).
async function baixarModelo(destino, aoProgresso, url = URL_MODELO) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`não consegui baixar o modelo (HTTP ${res.status})`);
  // Com compressão, o tamanho informado é o comprimido: aí não dá para comparar.
  const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
  const parcial = `${destino}.parcial`;
  const saida = fs.createWriteStream(parcial);
  let lido = 0;
  for await (const parte of Readable.fromWeb(res.body)) {
    if (!saida.write(parte)) await once(saida, 'drain');
    lido += parte.length;
    if (total) aoProgresso(lido / total);
  }
  await new Promise((resolve, reject) => saida.end((err) => (err ? reject(err) : resolve())));
  const baixado = fs.statSync(parcial).size;
  // Compara com o tamanho que o servidor anunciou (quando informa); senão, com um mínimo razoável.
  const incompleto = total ? baixado !== total : baixado < MODELO_MINIMO;
  if (incompleto) {
    fs.rmSync(parcial, { force: true });
    throw new Error('o modelo baixado está incompleto; tente de novo');
  }
  fs.renameSync(parcial, destino);
}

// Baixa um arquivo e confere o SHA-256 antes de dar o nome final. Arquivo com hash diferente é apagado.
async function baixarVerificado(url, destino, sha256, aoProgresso = () => {}) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`não consegui baixar ${path.basename(destino)} (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const parcial = `${destino}.parcial`;
  const saida = fs.createWriteStream(parcial);
  const hash = crypto.createHash('sha256');
  let lido = 0;
  for await (const parte of Readable.fromWeb(res.body)) {
    hash.update(parte);
    if (!saida.write(parte)) await once(saida, 'drain');
    lido += parte.length;
    if (total) aoProgresso(lido / total);
  }
  await new Promise((resolve, reject) => saida.end((err) => (err ? reject(err) : resolve())));
  if (sha256 && hash.digest('hex') !== sha256) {
    fs.rmSync(parcial, { force: true });
    throw new Error(`${path.basename(destino)} não confere (SHA-256 diferente); tente de novo`);
  }
  fs.renameSync(parcial, destino);
}

// Descompacta com o tar.exe do Windows 10/11 (aceita zip). Sem dependências extras.
function extrairZip(zip, destino) {
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(destino, { recursive: true });
  const r = spawnSync('tar', ['-xf', zip, '-C', destino], { stdio: 'ignore' });
  if (r.error || r.status !== 0) throw new Error(`não consegui descompactar ${path.basename(zip)}`);
}

// Primeira pasta (dentro de dir) que contém um arquivo com esse nome.
function acharPasta(dir, nomeArquivo) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const achou = acharPasta(full, nomeArquivo);
      if (achou) return achou;
    } else if (e.name.toLowerCase() === nomeArquivo.toLowerCase()) {
      return dir;
    }
  }
  return null;
}

// Copia para destino só os arquivos que passam no filtro (executável e DLLs necessárias).
function copiarArquivos(origem, destino, filtro) {
  fs.mkdirSync(destino, { recursive: true });
  for (const nome of fs.readdirSync(origem)) {
    if (filtro(nome)) fs.copyFileSync(path.join(origem, nome), path.join(destino, nome));
  }
}

function criarInstalador({ dataDir, appDir, plataforma = process.platform, fontesWindows = FONTES_WINDOWS }) {
  const c = caminhos(dataDir, appDir, plataforma);
  const windows = plataforma === 'win32';
  let ffmpeg = null; // escolhido uma vez e atualizado depois de instalar

  function escolherFfmpeg() {
    if (fs.existsSync(c.ffmpegDoProjeto)) {
      try { fs.chmodSync(c.ffmpegDoProjeto, 0o755); } catch { /* sem permissão para mudar: testa do jeito que está */ }
    }
    if (temFerramenta(c.ffmpegDoProjeto, ['-version'])) return c.ffmpegDoProjeto;
    if (!windows && temFerramenta('ffmpeg', ['-version'])) return 'ffmpeg';
    return null;
  }

  function estado() {
    if (ffmpeg === null) ffmpeg = escolherFfmpeg() || '';
    const whisper = fs.existsSync(c.whisperBin);
    const modelo = fs.existsSync(c.modelo);
    const ffmpegOk = Boolean(ffmpeg);
    return { pronto: whisper && modelo && ffmpegOk, whisper, modelo, ffmpeg: ffmpegOk };
  }

  function ferramentasFaltando() {
    if (windows) return []; // no Windows as ferramentas vêm do próprio download, não de pacotes do sistema
    return FERRAMENTAS.filter((f) => !temFerramenta(f.cmd, f.args));
  }

  async function instalarFerramentas(aoEtapa) {
    const faltando = ferramentasFaltando();
    if (!faltando.length) return;
    const pacotes = faltando.map((f) => f.pacote);
    if (!temFerramenta('dnf', ['--version']) || !temFerramenta('pkexec', ['--version'])) {
      throw new Error(`instale estes programas e tente de novo: ${pacotes.join(', ')}`);
    }
    aoEtapa({ etapa: 'ferramentas', texto: 'Instalando ferramentas do sistema…' });
    try {
      await rodar('pkexec', ['dnf', 'install', '-y', ...pacotes], { aoLinha: (t) => aoEtapa({ texto: t }) });
    } catch {
      throw new Error('a instalação das ferramentas foi cancelada ou não tem permissão');
    }
    if (ferramentasFaltando().length) throw new Error('as ferramentas não ficaram disponíveis; reinicie o app');
  }

  // Windows: baixa um zip fixado, confere o hash e extrai numa pasta temporária.
  async function baixarFerramentaWindows(fonte, nome, aoProgresso) {
    fs.mkdirSync(c.ferramentas, { recursive: true });
    const zip = path.join(c.ferramentas, `${nome}.zip`);
    await baixarVerificado(fonte.url, zip, fonte.sha256, aoProgresso);
    const pasta = path.join(c.ferramentas, `${nome}-extraido`);
    try {
      extrairZip(zip, pasta);
    } finally {
      fs.rmSync(zip, { force: true });
    }
    return pasta;
  }

  async function instalarWindows(aoEtapa) {
    if (!vcRuntimeInstalado()) {
      aoEtapa({ etapa: 'vcredist', pct: null, texto: 'Instalando o Visual C++ (pode pedir permissão de administrador)…' });
      await garantirVCRuntime(c.ferramentas, (p) => aoEtapa({ etapa: 'vcredist', pct: p, texto: 'Baixando o Visual C++…' }));
    }
    if (!fs.existsSync(c.whisperBin)) {
      const pasta = await baixarFerramentaWindows(fontesWindows.whisper, 'whisper', (p) =>
        aoEtapa({ etapa: 'whisper', pct: p, texto: 'Baixando o whisper.cpp…' }));
      try {
        const dll = acharPasta(pasta, 'whisper-cli.exe');
        if (!dll) throw new Error('o whisper-cli.exe não veio no pacote');
        copiarArquivos(dll, path.dirname(c.whisperBin), (n) => n.toLowerCase() === 'whisper-cli.exe' || n.toLowerCase().endsWith('.dll'));
      } finally {
        fs.rmSync(pasta, { recursive: true, force: true });
      }
    }

    if (!fs.existsSync(c.ffmpegDoProjeto)) {
      const pasta = await baixarFerramentaWindows(fontesWindows.ffmpeg, 'ffmpeg', (p) =>
        aoEtapa({ etapa: 'ffmpeg', pct: p, texto: 'Baixando o ffmpeg…' }));
      try {
        const bin = acharPasta(pasta, 'ffmpeg.exe');
        if (!bin) throw new Error('o ffmpeg.exe não veio no pacote');
        // Só o necessário: o ffmpeg e as DLLs dele (ffplay e ffprobe não são usados).
        copiarArquivos(bin, path.dirname(c.ffmpegDoProjeto), (n) => n.toLowerCase() === 'ffmpeg.exe' || n.toLowerCase().endsWith('.dll'));
      } finally {
        fs.rmSync(pasta, { recursive: true, force: true });
      }
    }
  }

  async function instalarLinux(aoEtapa) {
    await instalarFerramentas(aoEtapa);

    if (!fs.existsSync(path.join(c.whisperDir, '.git'))) {
      aoEtapa({ etapa: 'whisper', pct: null, texto: 'Baixando o whisper.cpp…' });
      fs.mkdirSync(path.dirname(c.whisperDir), { recursive: true });
      await rodar('git', ['clone', '--depth', '1', URL_WHISPER, c.whisperDir], { aoLinha: (t) => aoEtapa({ texto: t }) });
    }

    aoEtapa({ etapa: 'compilar', pct: null, texto: 'Compilando o whisper.cpp (alguns minutos)…' });
    await rodar('cmake', ['-S', c.whisperDir, '-B', c.buildDir, '-DCMAKE_BUILD_TYPE=Release'], { aoLinha: (t) => aoEtapa({ texto: t }) });
    await rodar('cmake', ['--build', c.buildDir, '--config', 'Release', '--target', 'whisper-cli', '--parallel', String(os.cpus().length)], { aoLinha: (t) => aoEtapa({ texto: t }) });
    if (!fs.existsSync(c.whisperBin)) throw new Error('o whisper-cli não foi gerado');
  }

  async function instalar(aoEtapa) {
    if (windows) await instalarWindows(aoEtapa);
    else await instalarLinux(aoEtapa);

    if (!fs.existsSync(c.modelo)) {
      aoEtapa({ etapa: 'modelo', pct: 0, texto: 'Baixando o modelo de voz (487 MB)…' });
      fs.mkdirSync(path.dirname(c.modelo), { recursive: true });
      await baixarModelo(c.modelo, (p) => aoEtapa({ etapa: 'modelo', pct: p, texto: 'Baixando o modelo de voz (487 MB)…' }));
    }

    ffmpeg = escolherFfmpeg();
    if (!ffmpeg) throw new Error('o ffmpeg não funciona neste computador');
    writeJsonAtomic(c.config, { ffmpeg, whisper: c.whisperBin, model: c.modelo, language: 'pt' });
    aoEtapa({ etapa: 'pronto', pct: 1, texto: 'Pronta para usar' });
  }

  return { estado, instalar, ferramentasFaltando };
}

module.exports = { criarInstalador, caminhos, baixarModelo, baixarVerificado, vcRuntimeInstalado, FONTES_WINDOWS };
