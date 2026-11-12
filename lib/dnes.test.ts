// Spuštění: npx tsx --test lib/dnes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { datumCesky, jeSkolniDen, pristiSkolniDen, souhrnTridy } from './dnes'

const zaci = [
  { id: 'a', first_name: 'Adam', last_name: 'Novák' },
  { id: 'b', first_name: 'Bára', last_name: 'Čermáková' },
  { id: 'c', first_name: 'Cyril', last_name: 'Dvořák' },
]

test('bez zapsané docházky: chybí podle celodenních omluvenek', () => {
  const s = souhrnTridy({
    zaci, dochazka: [], sObedem: null, doDruziny: null,
    omluvenky: [
      { student_id: 'a', status: 'pending', je_castecna: false, time_from: null, time_to: null },
      { student_id: 'b', status: 'approved', je_castecna: true, time_from: '08:00:00', time_to: '10:30:00' },
      { student_id: 'c', status: 'rejected', je_castecna: false, time_from: null, time_to: null },
      { student_id: 'x', status: 'approved', je_castecna: false, time_from: null, time_to: null }, // cizí žák
    ],
  })
  assert.equal(s.dochazkaZapsana, false)
  assert.deepEqual(s.chybi.map((c) => [c.id, c.duvod]), [['a', 'hlaseno']])
  assert.deepEqual(s.omluvenky.map((o) => [o.id, o.ceka, o.cas]), [['b', false, '08:00–10:30'], ['a', true, null]])
  assert.equal(s.bezObeda, null)
  assert.equal(s.druzina, null)
})

test('se zapsanou docházkou: chybí podle docházky, obědy a družina', () => {
  const s = souhrnTridy({
    zaci,
    dochazka: [
      { student_id: 'a', status: 'present' },
      { student_id: 'b', status: 'absent_unexcused' },
      { student_id: 'c', status: 'absent_excused' },
    ],
    omluvenky: [],
    sObedem: new Set(['a']),
    doDruziny: new Set(['a', 'c', 'zzz']),
  })
  assert.equal(s.dochazkaZapsana, true)
  assert.deepEqual(s.chybi.map((c) => [c.jmeno, c.duvod]), [['Čermáková Bára', 'neomluven'], ['Dvořák Cyril', 'omluven']])
  assert.deepEqual(s.bezObeda?.map((c) => c.id), ['b', 'c'])
  assert.equal(s.druzina, 2)
  assert.equal(s.pocet, 3)
})

test('školní dny, víkend, volno a příští školní den', () => {
  const volno = new Map([['2026-11-17', 'Den boje za svobodu a demokracii']])
  assert.equal(jeSkolniDen('2026-11-12', volno), true)   // čtvrtek
  assert.equal(jeSkolniDen('2026-11-14', volno), false)  // sobota
  assert.equal(jeSkolniDen('2026-11-17', volno), false)  // svátek
  assert.equal(pristiSkolniDen('2026-11-13', volno), '2026-11-16') // pá → po
  assert.equal(pristiSkolniDen('2026-11-16', volno), '2026-11-18') // přes svátek
  assert.equal(datumCesky('2026-11-12'), 'čtvrtek 12. listopadu')
})
