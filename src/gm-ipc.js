'use strict';

// Canais IPC da API GM_* (usados pela ponte de src/preload-gm.js).
const { ipcMain, Notification } = require('electron');
const { iconeDoApp } = require('./recursos');

function registerGmIpc(scripts) {
  const sync = (canal, fn) => ipcMain.on(canal, (e, ...args) => {
    try {
      e.returnValue = { v: fn(...args) };
    } catch (err) {
      e.returnValue = { erro: err.message };
    }
  });
  sync('gm:getValue', (t, k, d) => scripts.getValue(t, k, d));
  sync('gm:setValue', (t, k, v) => scripts.setValue(t, k, v));
  sync('gm:deleteValue', (t, k) => scripts.deleteValue(t, k));
  sync('gm:listValues', (t) => scripts.listValues(t));
  ipcMain.handle('gm:xhr', (_e, t, opts) => scripts.xhr(t, opts));
  ipcMain.handle('gm:notification', (_e, t, opts) => {
    const r = scripts.notification(t, opts || {});
    if (Notification.isSupported()) new Notification({ title: r.title || 'Dual Messenger', body: r.text, icon: iconeDoApp() }).show();
    return { ok: true };
  });
}

module.exports = { registerGmIpc };
