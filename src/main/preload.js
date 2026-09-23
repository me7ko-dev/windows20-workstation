'use strict'

const { contextBridge, ipcRenderer, clipboard } = require('electron')

/**
 * The only bridge between the canvas and the machine. Everything the renderer
 * can do to this computer is on this object — nothing else is exposed, and the
 * renderer never sees `require`.
 */
contextBridge.exposeInMainWorld('w20', {
  programs: () => ipcRenderer.invoke('programs:list'),
  // Text only, for the terminal's copy and paste.
  clipboard: {
    read: () => clipboard.readText(),
    write: (text) => clipboard.writeText(String(text))
  },
  home: () => ipcRenderer.invoke('sys:home'),
  pickFolder: () => ipcRenderer.invoke('sys:pick-folder'),

  launch: (id, args) => ipcRenderer.invoke('program:launch', { id, args }),
  openPath: (target) => ipcRenderer.invoke('sys:open-path', target),

  files: {
    list: (dir) => ipcRenderer.invoke('fs:list', dir)
  },

  editor: {
    /** Starts VS Code's own web server if it is not up yet, and gives its URL. */
    serve: (id) => ipcRenderer.invoke('editor:serve', id)
  },

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

  ai: {
    // The commands go out as ids and labels; only an id comes back, and the
    // renderer checks it against its own list before running anything.
    navigate: (request) => ipcRenderer.invoke('ai:navigate', request),
    // A conversation. The reply streams back in pieces tagged with the
    // request id; the key stays in the main process like everywhere else.
    chat: (request) => ipcRenderer.invoke('ai:chat', request),
    stop: (requestId) => ipcRenderer.send('ai:stop', requestId),
    onDelta: (handler) => {
      const listener = (_e, payload) => handler(payload)
      ipcRenderer.on('ai:delta', listener)
      return () => ipcRenderer.removeListener('ai:delta', listener)
    }
  },

  speech: {
    say: (text) => ipcRenderer.invoke('speech:say', text)
  },

  providers: () => ipcRenderer.invoke('providers:list'),

  genesis: {
    status: () => ipcRenderer.invoke('genesis:status'),
    /** { shell, args, ref } — the renderer opens it in a terminal window. */
    install: () => ipcRenderer.invoke('genesis:install'),
    window: () => ipcRenderer.invoke('genesis:window')
  },

  ui: {
    /** The title bar's Windows buttons are drawn by Windows; tell it the colours. */
    theme: (mode) => ipcRenderer.send('ui:theme', mode),
    onTheme: (handler) => {
      const listener = (_e, mode) => handler(mode)
      ipcRenderer.on('ui:theme', listener)
      return () => ipcRenderer.removeListener('ui:theme', listener)
    },
    /** From the global keys: Windows asked this station to listen. */
    onGlobal: (handler) => {
      const listener = (_e, what) => handler(what)
      ipcRenderer.on('ui:global', listener)
      return () => ipcRenderer.removeListener('ui:global', listener)
    }
  },

  keys: {
    /** The user's own keys from keybindings.json: { id: [combo…] }. */
    load: () => ipcRenderer.invoke('keys:load'),
    /** Opens keybindings.json in the system editor, writing it first if missing. */
    open: (defaults) => ipcRenderer.invoke('keys:open', defaults),
    onChange: (handler) => {
      const listener = (_e, payload) => handler(payload)
      ipcRenderer.on('keys:changed', listener)
      return () => ipcRenderer.removeListener('keys:changed', listener)
    }
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
