// Builds the prospecting CSV from the JSON records collected by extract_batch.js. Zero dependencies (Node ESM).
// RFC 4180 quoting, UTF-8 BOM (Excel on Windows), CRLF line endings, dedupe by mapsUrl (or name).
// CLI: node build-csv.mjs <records.json> [output.csv]   (prints CSV to stdout when no output file)
// Adapted from the owner's google-maps-scraper skill (build_csv.py).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeHours } from './normalize-hours.mjs'

export const COLUMNS = ['nombre', 'categoria', 'rating', 'num_reviews', 'telefono', 'direccion', 'sitio_web', 'website_host', 'horarios', 'plus_code', 'google_maps_url']
export const BOM = '﻿'

const s = (v) => (v == null ? '' : String(v))

export function csvField(v) {
  const t = s(v)
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export function toRows(records) {
  const seen = new Set()
  const rows = []
  for (const r of records) {
    const key = r.mapsUrl || r.name
    if (!key || seen.has(key)) continue
    seen.add(key)
    rows.push({
      nombre: s(r.name).trim(),
      categoria: s(r.category).trim(),
      rating: s(r.rating),
      num_reviews: s(r.reviews),
      telefono: s(r.phone),
      direccion: s(r.address).replace(/\s+/g, ' ').trim(),
      sitio_web: s(r.website),
      website_host: s(r.websiteHost).replace(/^(Sitio web|Website):\s*/, '').trim(),
      horarios: normalizeHours(r.hours),
      plus_code: s(r.plusCode).replace(/^Plus [Cc]ode:\s*/, '').trim(),
      google_maps_url: s(r.mapsUrl),
    })
  }
  return rows
}

export function buildCsv(records, { bom = true } = {}) {
  const rows = toRows(records)
  const lines = [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((c) => csvField(row[c])).join(','))]
  return { csv: (bom ? BOM : '') + lines.join('\r\n') + '\r\n', count: rows.length }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [inp, out] = process.argv.slice(2)
  if (!inp) {
    console.error('Usage: node build-csv.mjs <records.json> [output.csv]')
    process.exit(1)
  }
  const { csv, count } = buildCsv(JSON.parse(readFileSync(inp, 'utf8')))
  if (out) {
    writeFileSync(out, csv, 'utf8')
    console.error(`Wrote ${count} unique rows to ${out}`)
  } else process.stdout.write(csv)
}
