'use strict';

// Canais IPC da API GM_* (usados pela ponte de src/preload-gm.js).
// Quem valida token e @grant é o motor (src/motor.js).
const { ipcMain, Notification, shell, clipboard } = require('electron');
const { iconeDoApp } = require('./recursos');

function registerGmIpc(scripts, { aoMudar = () => {} } = {}) {
  // Chamadas síncronas (o script precisa do valor na hora): e.returnValue = { v } ou { erro }.
  const sync = (canal, fn) => ipcMain.on(canal, (e, ...args) => {
    try {
      e.returnValue = { v: fn(e, ...args) };
    } catch (err) {
      e.returnValue = { erro: err.message };
    }
  });
  sync('gm:getValue', (_e, t, k, d) => scripts.getValue(t, k, d));
  sync('gm:setValue', (_e, t, k, v) => scripts.setValue(t, k, v));
  sync('gm:deleteValue', (_e, t, k) => scripts.deleteValue(t, k));
  sync('gm:listValues', (_e, t) => scripts.listValues(t));
  sync('gm:menu', (e, t, nome) => {
    const id = scripts.registrarMenu(t, nome, e.sender.id);
    aoMudar();
    return id;
  });
  sync('gm:menuRemover', (e, t, id) => {
    scripts.removerMenu(t, id, e.sender.id);
    aoMudar();
  });

  ipcMain.handle('gm:xhr', (_e, t, opts) => scripts.xhr(t, opts));
  ipcMain.handle('gm:abrir', (_e, t, url) => {
    shell.openExternal(scripts.abrirUrl(t, url));
    return { ok: true };
  });
  ipcMain.handle('gm:copiar', (_e, t, texto) => {
    scripts.exigir(t, 'GM_setClipboard');
    clipboard.writeText(String(texto));
    return { ok: true };
  });
  ipcMain.handle('gm:notification', (_e, t, opts) => {
    const r = scripts.notification(t, opts || {});
    if (Notification.isSupported()) new Notification({ title: r.title || 'Dual Messenger', body: r.text, icon: iconeDoApp() }).show();
    return { ok: true };
  });
}

module.exports = { registerGmIpc };
