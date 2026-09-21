'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Workspace layout on disk. Small enough that a single JSON file written
 * atomically beats a database, and a corrupt file must never stop the app
 * from opening — a lost layout is recoverable, a shell that won't start is not.
 */
function createStore(userDataDir) {
  const file = path.join(userDataDir, 'workspaces.json')

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }

  function write(state) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
      fs.renameSync(tmp, file)
      return true
    } catch {
      return false
    }
  }

  return { read, write, file }
}

module.exports = { createStore }
