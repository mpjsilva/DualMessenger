'use strict';

// Atualização automática pelas releases do GitHub (electron-updater).
// Fluxo: acha versão nova → pergunta se pode atualizar (e avisa que o app reinicia) → baixa →
// fecha, instala e reabre. "Depois" não pergunta de novo até o app reiniciar.
// Recebe as peças de fora (autoUpdater, dialog…) para dar para testar sem Electron.

const HORAS = 6;

function criarAtualizador({ autoUpdater, dialog, janela, antesDeSair, log = () => {}, intervaloHoras = HORAS }) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  let manual = false;       // verificação pedida pelo usuário: mostra também "já está atualizado" e erros
  let baixando = false;
  let adiada = null;        // versão que o usuário deixou para depois
  let timer = null;

  const caixa = (opcoes) => {
    const win = janela();
    return win ? dialog.showMessageBox(win, opcoes) : dialog.showMessageBox(opcoes);
  };

  autoUpdater.on('update-available', async (info) => {
    const pedida = manual;
    manual = false;
    if (baixando || (adiada === info.version && !pedida)) return;
    const r = await caixa({
      type: 'question',
      title: 'Atualização disponível',
      message: `A versão ${info.version} do Dual Messenger está disponível.`,
      detail: 'Posso atualizar agora? O app vai fechar, atualizar e abrir de novo sozinho.',
      buttons: ['Atualizar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response !== 0) {
      adiada = info.version;
      return;
    }
    baixando = true;
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      baixando = false;
      log('download da atualização falhou:', err.message);
      await caixa({ type: 'error', title: 'Atualização', message: 'Não consegui baixar a atualização.', detail: String(err.message).slice(0, 300), buttons: ['OK'] });
    }
  });

  autoUpdater.on('update-not-available', async () => {
    if (!manual) return;
    manual = false;
    await caixa({ type: 'info', title: 'Atualização', message: 'Você já está na versão mais recente.', buttons: ['OK'] });
  });

  autoUpdater.on('update-downloaded', () => {
    baixando = false;
    if (antesDeSair) antesDeSair();
    // (silencioso = falso, reabrir = verdadeiro): fecha, instala e abre o app de novo.
    autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on('error', async (err) => {
    log('atualizador:', err && err.message);
    const pedida = manual;
    manual = false;
    if (!pedida) return;
    await caixa({ type: 'error', title: 'Atualização', message: 'Não consegui verificar atualizações.', detail: String((err && err.message) || err).slice(0, 300), buttons: ['OK'] });
  });

  function verificar({ pedido = false } = {}) {
    if (baixando) return Promise.resolve();
    manual = pedido;
    return autoUpdater.checkForUpdates().catch((err) => log('verificação falhou:', err.message));
  }

  function iniciar() {
    verificar();
    timer = setInterval(() => verificar(), intervaloHoras * 3600 * 1000);
    if (timer.unref) timer.unref();
  }

  function parar() {
    clearInterval(timer);
  }

  return { iniciar, verificar, parar };
}

module.exports = { criarAtualizador };
