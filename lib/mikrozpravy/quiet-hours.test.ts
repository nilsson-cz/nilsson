// lib/mikrozpravy/quiet-hours.test.ts
// Spuštění: node --test lib/mikrozpravy/*.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isQuietHours, nextSendAt, pragueDate } from './quiet-hours.ts'

const at = (iso: string) => new Date(iso)

test('den: odejde hned + 60 s', () => {
  const now = at('2026-07-01T08:00:00Z') // 10:00 SELČ
  const r = nextSendAt(now, false)
  assert.equal(r.heldByQuietHours, false)
  assert.equal(r.sendAt.toISOString(), '2026-07-01T08:01:00.000Z')
})

test('22:00 SEČ → zítra 7:00 SEČ', () => {
  const r = nextSendAt(at('2026-11-08T21:00:00Z'), false)
  assert.equal(r.heldByQuietHours, true)
  assert.equal(r.sendAt.toISOString(), '2026-11-09T06:00:00.000Z')
})

test('3:00 SEČ → dnes 7:00', () => {
  const r = nextSendAt(at('2026-11-09T02:00:00Z'), false)
  assert.equal(r.sendAt.toISOString(), '2026-11-09T06:00:00.000Z')
})

test('naléhavá zpráva tiché hodiny obchází', () => {
  const r = nextSendAt(at('2026-11-08T22:00:00Z'), true)
  assert.equal(r.heldByQuietHours, false)
  assert.equal(r.sendAt.toISOString(), '2026-11-08T22:01:00.000Z')
})

test('20:59:30 → okno přesáhne 21:00 → čeká do 7:00', () => {
  const r = nextSendAt(at('2026-11-08T19:59:30Z'), false)
  assert.equal(r.heldByQuietHours, true)
  assert.equal(r.sendAt.toISOString(), '2026-11-09T06:00:00.000Z')
})

test('6:59:30 → okno skončí po 7:00 → hned', () => {
  const r = nextSendAt(at('2026-11-09T05:59:30Z'), false)
  assert.equal(r.heldByQuietHours, false)
})

test('přechod na letní čas: sobota 22:00 SEČ → neděle 7:00 SELČ', () => {
  const r = nextSendAt(at('2026-03-28T21:00:00Z'), false)
  assert.equal(r.sendAt.toISOString(), '2026-03-29T05:00:00.000Z')
})

test('přechod na zimní čas: sobota 22:00 SELČ → neděle 7:00 SEČ', () => {
  const r = nextSendAt(at('2026-10-24T20:00:00Z'), false)
  assert.equal(r.sendAt.toISOString(), '2026-10-25T06:00:00.000Z')
})

test('přelom měsíce: 31. 1. 23:00 → 1. 2. 7:00', () => {
  const r = nextSendAt(at('2027-01-31T22:00:00Z'), false)
  assert.equal(r.sendAt.toISOString(), '2027-02-01T06:00:00.000Z')
})

test('isQuietHours hranice', () => {
  assert.equal(isQuietHours(at('2026-11-08T19:59:00Z')), false) // 20:59
  assert.equal(isQuietHours(at('2026-11-08T20:00:00Z')), true)  // 21:00
  assert.equal(isQuietHours(at('2026-11-09T05:59:00Z')), true)  // 6:59
  assert.equal(isQuietHours(at('2026-11-09T06:00:00Z')), false) // 7:00
})

test('pragueDate po půlnoci pražského času', () => {
  assert.equal(pragueDate(at('2026-11-08T23:30:00Z')), '2026-11-09')
  assert.equal(pragueDate(at('2026-11-08T22:30:00Z')), '2026-11-08')
})
