// Guardrails of the WhatsApp integration, in ONE place (never only in a prompt).
// Defaults can be overridden by ~/.agentos/whatsapp.json (BACKOFFICE_HOME overrides the folder):
//   { "max_per_hour": 20, "max_per_day": 100, "max_text_length": 1500 }
// Mode: read + send only with the person's click. Agents never send; there is no send tool.
import { readFileSync } from 'node:fs'
import { backofficeHome } from './paths.mjs'
import { join } from 'node:path'

export const DEFAULT_WA_LIMITS = Object.freeze({ max_per_hour: 20, max_per_day: 100, max_text_length: 1500 })

const posInt = (v) => (Number.isInteger(v) && v > 0 && v < 1_000_000 ? v : undefined)

/** Defaults + overrides from whatsapp.json (invalid or missing file = defaults). */
export function loadWaLimits({ env = process.env, home = backofficeHome({ env }) } = {}) {
  let j = {}
  try { j = JSON.parse(readFileSync(join(home, 'whatsapp.json'), 'utf8')) } catch { /* missing or invalid */ }
  const out = { ...DEFAULT_WA_LIMITS }
  for (const k of Object.keys(out)) { const v = posInt(j?.[k]); if (v) out[k] = v }
  return out
}

/** Groups, broadcast lists, status and channels are never read or written. */
export const isBlockedChat = (chatId) => !/@(c|s)\.us$/.test(String(chatId ?? '')) || /^status@/.test(String(chatId)) || /@(g|broadcast|newsletter)/.test(String(chatId))

/** Returns { code, message, http } when the send must be refused, or null when allowed. */
export function checkSend({ limits, text, chatId, hasInbound, sentLastHour, sentLastDay }) {
  if (isBlockedChat(chatId)) return { code: 'chat_blocked', http: 400, message: 'No se envían mensajes a grupos, difusiones ni estados.' }
  if (typeof text !== 'string' || !text.trim()) return { code: 'empty_text', http: 400, message: 'El mensaje está vacío.' }
  if (text.length > limits.max_text_length) return { code: 'text_too_long', http: 400, message: `El mensaje admite hasta ${limits.max_text_length} caracteres.` }
  if (!hasInbound) return { code: 'no_inbound', http: 409, message: 'Sólo se responde a chats que ya te escribieron (nada de mensajes en frío).' }
  if (sentLastHour >= limits.max_per_hour) return { code: 'rate_hour', http: 429, message: `Límite de ${limits.max_per_hour} envíos por hora alcanzado. Espera un rato.` }
  if (sentLastDay >= limits.max_per_day) return { code: 'rate_day', http: 429, message: `Límite de ${limits.max_per_day} envíos por día alcanzado.` }
  return null
}
