'use strict';

// Ponte da API GM_* para as páginas das contas. Só repassa chamadas ao processo
// principal; quem valida token e @grant é o motor (src/motor.js).
const { contextBridge, ipcRenderer } = require('electron');

// Respostas síncronas vêm como { v } ou { erro }.
function sincrono(canal, ...args) {
  const r = ipcRenderer.sendSync(canal, ...args);
  if (r && r.erro) throw new Error(r.erro);
  return r ? r.v : undefined;
}

contextBridge.exposeInMainWorld('__dmGM', {
  getValue: (t, k, d) => sincrono('gm:getValue', t, k, d),
  setValue: (t, k, v) => sincrono('gm:setValue', t, k, v),
  deleteValue: (t, k) => sincrono('gm:deleteValue', t, k),
  listValues: (t) => sincrono('gm:listValues', t),
  menu: (t, nome) => sincrono('gm:menu', t, nome),
  menuRemover: (t, id) => sincrono('gm:menuRemover', t, id),
  xhr: (t, opts) => ipcRenderer.invoke('gm:xhr', t, opts),
  notification: (t, opts) => ipcRenderer.invoke('gm:notification', t, opts),
  abrir: (t, url) => ipcRenderer.invoke('gm:abrir', t, url),
  copiar: (t, texto) => ipcRenderer.invoke('gm:copiar', t, texto),
});
