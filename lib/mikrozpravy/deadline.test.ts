// lib/mikrozpravy/deadline.test.ts
// Spuštění: node --test lib/mikrozpravy/*.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDeadline, parseOptions } from './deadline.ts'

const now = new Date('2026-11-09T08:00:00Z') // pondělí 9:00 SEČ

function at(input: string, n = now): string {
  const r = parseDeadline(input, n)
  if (!r.ok) throw new Error(r.error)
  return r.at.toISOString()
}

test('jen čas = dnes', () => {
  assert.equal(at('14:00'), '2026-11-09T13:00:00.000Z')
  assert.equal(at('14.30'), '2026-11-09T13:30:00.000Z')
  assert.equal(at('14'), '2026-11-09T13:00:00.000Z')
  assert.equal(at('14 h'), '2026-11-09T13:00:00.000Z')
})

test('dnes / zítra (i bez diakritiky)', () => {
  assert.equal(at('dnes 18:00'), '2026-11-09T17:00:00.000Z')
  assert.equal(at('zítra 8:30'), '2026-11-10T07:30:00.000Z')
  assert.equal(at('Zitra 8:30'), '2026-11-10T07:30:00.000Z')
})

test('datum', () => {
  assert.equal(at('12.11. 18:00'), '2026-11-12T17:00:00.000Z')
  assert.equal(at('12. 11. 2026 18:00'), '2026-11-12T17:00:00.000Z')
})

test('datum v létě (SELČ)', () => {
  const summer = new Date('2026-06-01T08:00:00Z')
  assert.equal(at('3.6. 12:00', summer), '2026-06-03T10:00:00.000Z')
})

test('přelom roku: 3.1. zadané v prosinci = příští rok', () => {
  const dec = new Date('2026-12-28T08:00:00Z')
  assert.equal(at('3.1. 12:00', dec), '2027-01-03T11:00:00.000Z')
})

test('chyby', () => {
  assert.equal(parseDeadline('8:00', now).ok, false)        // už minulo
  assert.equal(parseDeadline('9:02', now).ok, false)        // méně než 5 min
  assert.equal(parseDeadline('25:00', now).ok, false)
  assert.equal(parseDeadline('31.2. 10:00', now).ok, false)
  assert.equal(parseDeadline('za hodinu', now).ok, false)
  assert.equal(parseDeadline('30.11. 10:00', now).ok, false) // > 14 dní
})

test('možnosti ankety', () => {
  assert.deepEqual(parseOptions('Ano\nNe'), { ok: true, options: ['Ano', 'Ne'] })
  assert.deepEqual(parseOptions('- Ano\n- Ne\n\n• Nevím'), { ok: true, options: ['Ano', 'Ne', 'Nevím'] })
  assert.deepEqual(parseOptions('1. Ano\n2) Ne'), { ok: true, options: ['Ano', 'Ne'] })
  assert.deepEqual(parseOptions('Ano\nano\nNe'), { ok: true, options: ['Ano', 'Ne'] })
  assert.equal(parseOptions('Ano').ok, false)
  assert.equal(parseOptions('a\nb\nc\nd\ne\nf').ok, false)
  assert.equal(parseOptions('a\n' + 'x'.repeat(61)).ok, false)
})
