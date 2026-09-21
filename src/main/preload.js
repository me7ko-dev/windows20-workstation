'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * The only bridge between the canvas and the machine. Everything the renderer
 * can do to this computer is on this object — nothing else is exposed, and the
 * renderer never sees `require`.
 */
contextBridge.exposeInMainWorld('w20', {
  programs: () => ipcRenderer.invoke('programs:list'),
  home: () => ipcRenderer.invoke('sys:home'),
  pickFolder: () => ipcRenderer.invoke('sys:pick-folder'),

  launch: (id, args) => ipcRenderer.invoke('program:launch', { id, args }),
  openPath: (target) => ipcRenderer.invoke('sys:open-path', target),

  term: {
    create: (opts) => ipcRenderer.invoke('term:create', opts),
    write: (id, data) => ipcRenderer.send('term:write', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('term:resize', { id, cols, rows }),
    kill: (id) => ipcRenderer.send('term:kill', { id }),
    onData: (handler) => {
      const listener = (_e, payload) => handler(payload)
      ipcRenderer.on('term:data', listener)
      return () => ipcRenderer.removeListener('term:data', listener)
    },
    onExit: (handler) => {
      const listener = (_e, payload) => handler(payload)
      ipcRenderer.on('term:exit', listener)
      return () => ipcRenderer.removeListener('term:exit', listener)
    }
  },

  voice: {
    // The key never crosses this bridge — audio goes out, text comes back.
    transcribe: (buffer, mimeType) => ipcRenderer.invoke('voice:transcribe', { buffer, mimeType })
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },

  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (state) => ipcRenderer.invoke('state:save', state)
  },

  station: {
    info: () => ipcRenderer.invoke('station:info'),
    open: () => ipcRenderer.invoke('station:open'),
    cycle: (delta) => ipcRenderer.invoke('station:cycle', delta),
    tile: () => ipcRenderer.invoke('station:tile'),
    onFlip: (handler) => {
      const listener = (_e, payload) => handler(payload)
      ipcRenderer.on('station:flip', listener)
      return () => ipcRenderer.removeListener('station:flip', listener)
    }
  }
})
