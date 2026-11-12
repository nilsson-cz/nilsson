// Spuštění: npx tsx --test lib/spayd.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { czIban, parseCzAccount, spayd, spaydMessage } from './spayd'

test('IBAN z českého účtu (vzorový příklad ČNB)', () => {
  const a = parseCzAccount('19-2000145399', '0800')
  assert.ok(a)
  assert.equal(czIban(a!), 'CZ6508000000192000145399')
})

test('neplatný účet / kód banky → null', () => {
  assert.equal(parseCzAccount('123456789', '0800'), null) // modulo 11 nesedí
  assert.equal(parseCzAccount('2600000003', '08'), null)
  assert.equal(parseCzAccount('', ''), null)
  assert.ok(parseCzAccount('2600000003', '2010'))
})

test('SPAYD s částkou, VS, SS a zprávou bez diakritiky', () => {
  assert.equal(
    spayd({ iban: 'CZ65 0800 0000 1920 0014 5399', amount: 250, vs: '0042', ss: '1020270100', message: 'Obědy — Žluťoučký kůň*' }),
    'SPD*1.0*ACC:CZ6508000000192000145399*AM:250.00*CC:CZK*X-VS:0042*X-SS:1020270100*MSG:Obedy Zlutoucky kun',
  )
})

test('nečíselný VS / prázdné SS se vynechá', () => {
  assert.equal(
    spayd({ iban: 'CZ6508000000192000145399', amount: 1, vs: 'D26-001', ss: '', message: '' }),
    'SPD*1.0*ACC:CZ6508000000192000145399*AM:1.00*CC:CZK',
  )
})

test('zpráva max 60 znaků, nulová částka vyhodí', () => {
  assert.equal(spaydMessage('x'.repeat(80)).length, 60)
  assert.throws(() => spayd({ iban: 'CZ00', amount: 0 }))
})
