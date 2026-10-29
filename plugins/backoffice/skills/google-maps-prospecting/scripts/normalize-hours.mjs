// Normalizes Google Maps hours strings. Zero dependencies (Node ESM).
// "jueves: 9 a.m.–1 p.m.3–7:30 p.m." -> "jue: 9am-1pm y 3-7:30pm", days ordered Mon->Sun.
// Adapted from the owner's google-maps-scraper skill (normalize_hours.py).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DAYS = {
  lunes: ['lun', 0], martes: ['mar', 1], miércoles: ['mié', 2], miercoles: ['mié', 2], jueves: ['jue', 3],
  viernes: ['vie', 4], sábado: ['sáb', 5], sabado: ['sáb', 5], domingo: ['dom', 6],
  monday: ['mon', 0], tuesday: ['tue', 1], wednesday: ['wed', 2], thursday: ['thu', 3],
  friday: ['fri', 4], saturday: ['sat', 5], sunday: ['sun', 6],
}

const shortDay = (day) => DAYS[day.trim().toLowerCase()] ?? [day.trim(), 99]

export function cleanTime(t) {
  let s = String(t).replace(/[–—]/g, '-')
  s = s.replace(/\s*a\.\s*m\./gi, 'am').replace(/\s*p\.\s*m\./gi, 'pm')
  s = s.replace(/\s+/g, ' ').trim()
  return s.replace(/(am|pm)(\d)/g, '$1 y $2') // split run-on ranges
}

export function normalizeHours(hours) {
  if (!hours) return ''
  const rows = []
  for (const p of String(hours).split('|').map((x) => x.trim())) {
    const i = p.indexOf(':')
    if (i < 0) continue
    const [short, idx] = shortDay(p.slice(0, i))
    rows.push([idx, short, cleanTime(p.slice(i + 1))])
  }
  rows.sort((a, b) => a[0] - b[0]) // stable
  return rows.map(([, d, t]) => `${d}: ${t}`).join(' | ')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // CLI: node normalize-hours.mjs "<hours string>"   or   node normalize-hours.mjs --file hours.txt
  const a = process.argv.slice(2)
  const input = a[0] === '--file' ? readFileSync(a[1], 'utf8') : a.join(' ')
  console.log(normalizeHours(input))
}
