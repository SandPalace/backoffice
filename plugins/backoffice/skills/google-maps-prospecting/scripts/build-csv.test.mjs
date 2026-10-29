import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { buildCsv, csvField, COLUMNS } from './build-csv.mjs'

test('quotes commas, quotes and newlines (RFC 4180)', () => {
  assert.equal(csvField('a,b'), '"a,b"')
  assert.equal(csvField('di "x"'), '"di ""x"""')
  assert.equal(csvField('l1\nl2'), '"l1\nl2"')
  assert.equal(csvField('plain'), 'plain')
  assert.equal(csvField(undefined), '')
})
test('BOM, header, CRLF, accents and no fabrication of missing fields', () => {
  const { csv, count } = buildCsv([{ name: 'Café Ñandú, S.A.', mapsUrl: 'u1', phone: '81 1234 5678', hours: 'lunes: 9 a.m.–1 p.m.', websiteHost: 'Sitio web: x.com', plusCode: 'Plus code: 8Q9' }])
  assert.equal(count, 1)
  assert.ok(csv.startsWith('﻿' + COLUMNS.join(',') + '\r\n'))
  assert.ok(csv.includes('"Café Ñandú, S.A.",,,,81 1234 5678,,,x.com,lun: 9am-1pm,8Q9,u1\r\n'))
})
test('dedupes by mapsUrl then name; skips records without key', () => {
  const { count } = buildCsv([{ name: 'A', mapsUrl: 'u' }, { name: 'A2', mapsUrl: 'u' }, { name: 'B' }, { name: 'B' }, {}])
  assert.equal(count, 2)
})
test('CLI reads JSON file and prints CSV', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'bc-')), 'r.json')
  writeFileSync(f, JSON.stringify([{ name: 'Z', mapsUrl: 'z' }]))
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('./build-csv.mjs', import.meta.url)), f], { encoding: 'utf8' })
  assert.ok(out.startsWith('﻿nombre,'))
})
