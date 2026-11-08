// lib/mikrozpravy/token.test.ts
// Spuštění: node --test lib/mikrozpravy/*.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isWellFormedToken, newToken, tokenExpiry, tokenHashHex } from './token.ts'

test('token je 43 znaků base64url a pokaždé jiný', () => {
  const a = newToken()
  const b = newToken()
  assert.equal(isWellFormedToken(a), true)
  assert.notEqual(a, b)
})

test('nesmyslné tokeny neprojdou kontrolou tvaru', () => {
  assert.equal(isWellFormedToken(''), false)
  assert.equal(isWellFormedToken('a'.repeat(42)), false)
  assert.equal(isWellFormedToken('a'.repeat(42) + '/'), false)
  assert.equal(isWellFormedToken('../../etc/passwd'), false)
})

test('hash je deterministický bytea hex (\\x + 64 hex znaků)', () => {
  const t = newToken()
  assert.equal(tokenHashHex(t), tokenHashHex(t))
  assert.match(tokenHashHex(t), /^\\x[0-9a-f]{64}$/)
  assert.notEqual(tokenHashHex(t), tokenHashHex(newToken()))
})

test('expirace za 30 dní', () => {
  const from = new Date('2026-11-08T10:00:00Z')
  assert.equal(tokenExpiry(from), '2026-12-08T10:00:00.000Z')
})
