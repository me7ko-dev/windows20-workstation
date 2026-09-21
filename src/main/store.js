'use strict'

const fs = require('fs')
const path = require('path')

/**
 * Workspace layout on disk, for every station window at once.
 *
 * One file rather than one per window, because only the main process writes it
 * and a single atomic rename can never leave two stations disagreeing about who
 * exists. Small enough that a JSON file beats a database, and a corrupt file
 * must never stop the app from opening — a lost layout is recoverable, a shell
 * that won't start is not.
 *
 * `order` is the stations that were open when the app last ran, so three
 * stations come back as three stations.
 */
function createStore(userDataDir) {
  const file = path.join(userDataDir, 'stations.json')
  const legacy = path.join(userDataDir, 'workspaces.json')

  function read() {
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { order: doc.order || [], states: doc.states || {} }
    } catch {
      return migrate()
    }
  }

  /** A layout saved before stations existed becomes the first station's. */
  function migrate() {
    try {
      return { order: ['01'], states: { '01': JSON.parse(fs.readFileSync(legacy, 'utf8')) } }
    } catch {
      return { order: [], states: {} }
    }
  }

  function write(doc) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true })
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2))
      fs.renameSync(tmp, file)
      return true
    } catch {
      return false
    }
  }

  function update(fn) {
    const doc = read()
    fn(doc)
    return write(doc)
  }

  return {
    file,
    /** Station ids to reopen on startup. */
    order: () => read().order,
    loadStation: (station) => read().states[station] || null,
    saveStation: (station, state) =>
      update((doc) => {
        doc.states[station] = state
        if (!doc.order.includes(station)) doc.order.push(station)
      }),
    /** A station that has just opened, before it has saved anything. */
    remember: (station) =>
      update((doc) => {
        if (!doc.order.includes(station)) doc.order.push(station)
      }),
    /** The user closed this station — it should not come back. */
    forget: (station) =>
      update((doc) => {
        delete doc.states[station]
        doc.order = doc.order.filter((id) => id !== station)
      })
  }
}

module.exports = { createStore }
