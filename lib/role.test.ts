// Spuštění: npx tsx --test lib/role.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cilPoPrihlaseni, dnesPraha, jeAktivniZamestnanec, parseRole, roleForPath, safeNext } from './role'

test('roleForPath', () => {
  assert.equal(roleForPath('/dashboard'), 'skola')
  assert.equal(roleForPath('/dashboard/platby'), 'skola')
  assert.equal(roleForPath('/portal'), 'rodic')
  assert.equal(roleForPath('/portal/omluvenky'), 'rodic')
  assert.equal(roleForPath('/portal/login'), null)
  assert.equal(roleForPath('/portalx'), null)
  assert.equal(roleForPath('/login'), null)
})

test('safeNext odmítne cizí adresy', () => {
  assert.equal(safeNext('/portal/platby?x=1'), '/portal/platby?x=1')
  assert.equal(safeNext('//evil.example'), null)
  assert.equal(safeNext('https://evil.example'), null)
  assert.equal(safeNext('/' + String.fromCharCode(92) + 'evil.example'), null)
  assert.equal(safeNext(null), null)
})

test('jen jedna role', () => {
  assert.equal(cilPoPrihlaseni({ isStaff: true, isGuardian: false }), '/dashboard')
  assert.equal(cilPoPrihlaseni({ isStaff: false, isGuardian: true }), '/portal')
  assert.equal(cilPoPrihlaseni({ isStaff: false, isGuardian: false }), null)
  // next do části bez práva se ignoruje
  assert.equal(cilPoPrihlaseni({ isStaff: false, isGuardian: true, next: '/dashboard/zaci' }), '/portal')
  assert.equal(cilPoPrihlaseni({ isStaff: true, isGuardian: false, next: '/portal' }), '/dashboard')
})

test('obě role: next > poslední role > Škola', () => {
  const obe = { isStaff: true, isGuardian: true }
  assert.equal(cilPoPrihlaseni({ ...obe, next: '/portal/platby', lastRole: 'skola' }), '/portal/platby')
  assert.equal(cilPoPrihlaseni({ ...obe, next: '/dashboard/zaci', lastRole: 'rodic' }), '/dashboard/zaci')
  assert.equal(cilPoPrihlaseni({ ...obe, lastRole: 'rodic' }), '/portal')
  assert.equal(cilPoPrihlaseni({ ...obe, lastRole: 'skola' }), '/dashboard')
  assert.equal(cilPoPrihlaseni({ ...obe }), '/dashboard')
  assert.equal(cilPoPrihlaseni({ ...obe, next: '/login' }), '/dashboard')
})

test('parseRole', () => {
  assert.equal(parseRole('rodic'), 'rodic')
  assert.equal(parseRole('admin'), null)
  assert.equal(parseRole(undefined), null)
})

test('jeAktivniZamestnanec — do dne konce včetně', () => {
  assert.equal(jeAktivniZamestnanec(null, '2026-11-12'), true)
  assert.equal(jeAktivniZamestnanec('2026-11-12', '2026-11-12'), true)
  assert.equal(jeAktivniZamestnanec('2026-11-11', '2026-11-12'), false)
  assert.equal(jeAktivniZamestnanec('2027-08-31', '2026-11-12'), true)
})

test('dnesPraha — po půlnoci v Praze už je další den', () => {
  assert.equal(dnesPraha(new Date('2026-11-12T23:30:00Z')), '2026-11-13')
  assert.equal(dnesPraha(new Date('2026-07-01T21:59:00Z')), '2026-07-01')
})
