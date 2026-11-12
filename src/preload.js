'use strict';

// Ponte mínima entre a barra de abas (ui/) e o processo principal.
// Só expõe canais listados aqui; o resto do Electron fica fora do alcance da página.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('dm', {
  getState: () => call('state:get'),
  newAccount: (service) => call('account:new', service),
  openAccount: (id) => call('account:open', id),
  deleteAccount: (id) => call('account:delete', id),
  selectTab: (id) => call('tab:select', id),
  closeTab: (id) => call('tab:close', id),
  moveTab: (id, destino) => call('tab:move', id, destino),
  setPanel: (open) => call('panel:set', open),
  setMenu: (open) => call('menu:set', open),
  addFavorite: (accountId, nome) => call('fav:add', accountId, nome),
  removeFavorite: (id) => call('fav:remove', id),
  openFavorite: (id) => call('fav:open', id),
  moveFavorite: (id, destino) => call('fav:move', id, destino),
  abrirLink: (url) => call('link:abrir', url),
  renameAccount: (id, nome) => call('account:rename', id, nome),
  setTheme: (tema) => call('tema:set', tema),
  prepararTranscricao: () => call('transcricao:instalar'),
  importScript: () => call('script:import'),
  toggleScript: (id, enabled) => call('script:toggle', id, enabled),
  removeScript: (id) => call('script:remove', id),
  addDomain: (dominio) => call('dominios:adicionar', dominio),
  removeDomain: (dominio) => call('dominios:remover', dominio),
  runCommand: (id) => call('script:comando', id),
  onStateChanged: (fn) => {
    ipcRenderer.on('state:changed', (_e, state) => fn(state));
  },
});
