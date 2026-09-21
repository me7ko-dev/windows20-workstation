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

  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (state) => ipcRenderer.invoke('state:save', state)
  }
})
