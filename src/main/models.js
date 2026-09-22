'use strict'

/**
 * Finding a model that still exists.
 *
 * Free services retire models every few months — Groq switched off the Llama
 * that used to be this station's default in August 2026. A default that has
 * gone is not a reason for the voice to stop working: the service is asked
 * what it serves now, and the first model matching the provider's preferences
 * is used, and remembered until the app restarts.
 */

const found = new Map() // `${provider}:${job}` -> model id

async function listModels(baseUrl, apiKey) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  })
  if (!response.ok) return []
  const data = await response.json()
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []
  // Gemini answers with "models/gemini-…"; the chat endpoint wants it bare.
  return list.map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean)
}

/** The first listed model matching the earliest preference, or null. */
async function discover(provider, job, baseUrl, apiKey, prefer) {
  const key = `${provider}:${job}`
  if (found.has(key)) return found.get(key)
  let ids = []
  try {
    ids = await listModels(baseUrl, apiKey)
  } catch {
    return null
  }
  for (const pattern of prefer || []) {
    const hit = ids.find((id) => pattern.test(id))
    if (hit) {
      found.set(key, hit)
      return hit
    }
  }
  return null
}

function remembered(provider, job) {
  return found.get(`${provider}:${job}`) || null
}

/** Does this error say the model is the problem, rather than the key or the limit? */
function modelIsGone(status, detail) {
  if (status === 404) return true
  return (status === 400 || status === 422) && /model/i.test(detail || '') && /(not|no longer|decommission|deprecat|exist|found|support)/i.test(detail || '')
}

module.exports = { discover, remembered, modelIsGone, listModels }
