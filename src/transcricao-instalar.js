'use strict';

// Prepara a transcrição dentro do próprio app (botão em Opções › Transcrição):
// instala as ferramentas que faltam (pedindo a senha pela janela do sistema),
// compila o whisper.cpp, baixa o modelo e grava transcricao.json.
// Tudo fica na pasta de dados do app. Quem já tiver algo pronto não baixa de novo.

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

// Ferramentas do sistema e o pacote Fedora que as fornece.
const FERRAMENTAS = [
  { cmd: 'git', args: ['--version'], pacote: 'git' },
  { cmd: 'cmake', args: ['--version'], pacote: 'cmake' },
  { cmd: 'g++', args: ['--version'], pacote: 'gcc-c++' },
  { cmd: 'ffmpeg', args: ['-version'], pacote: 'ffmpeg' },
];

function caminhos(dataDir, appDir) {
  const whisperDir = path.join(dataDir, 'whisper.cpp');
  return {
    whisperDir,
    buildDir: path.join(whisperDir, 'build'),
    whisperBin: path.join(whisperDir, 'build', 'bin', 'whisper-cli'),
    modelo: path.join(dataDir, 'modelos', MODELO_PADRAO),
    ffmpegDoProjeto: path.join(appDir, 'vendor', 'bin', 'ffmpeg'),
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

function criarInstalador({ dataDir, appDir }) {
  const c = caminhos(dataDir, appDir);
  let ffmpeg = null; // escolhido uma vez e atualizado depois de instalar

  function escolherFfmpeg() {
    if (fs.existsSync(c.ffmpegDoProjeto)) {
      try { fs.chmodSync(c.ffmpegDoProjeto, 0o755); } catch { /* sem permissão para mudar: testa do jeito que está */ }
    }
    if (temFerramenta(c.ffmpegDoProjeto, ['-version'])) return c.ffmpegDoProjeto;
    if (temFerramenta('ffmpeg', ['-version'])) return 'ffmpeg';
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

  async function instalar(aoEtapa) {
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

module.exports = { criarInstalador, caminhos, baixarModelo };
