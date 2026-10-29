import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeHours, cleanTime } from './normalize-hours.mjs'

test('splits run-on ranges and compacts am/pm', () => {
  assert.equal(normalizeHours('jueves: 9 a.m.–1 p.m.3–7:30 p.m.'), 'jue: 9am-1pm y 3-7:30pm')
})
test('orders days Mon->Sun and keeps Cerrado', () => {
  const src = 'jueves: 9 a.m.–1 p.m.3–7:30 p.m. | domingo: Cerrado | lunes: 9 a.m.–1 p.m. | sábado: 9 a.m.–1 p.m.'
  assert.equal(normalizeHours(src), 'lun: 9am-1pm | jue: 9am-1pm y 3-7:30pm | sáb: 9am-1pm | dom: Cerrado')
})
test('English days and empty input', () => {
  assert.equal(normalizeHours('Sunday: Closed | Monday: 9 AM–5 PM'), 'mon: 9 AM-5 PM | sun: Closed')
  assert.equal(normalizeHours(''), '')
  assert.equal(normalizeHours(undefined), '')
})
test('cleanTime', () => assert.equal(cleanTime('9 a.m.–1 p.m.3–7 p.m.'), '9am-1pm y 3-7pm'))
