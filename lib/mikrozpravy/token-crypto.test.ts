// lib/mikrozpravy/token-crypto.test.ts
// Spuštění: node --test lib/mikrozpravy/*.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MICRO_LINK_SECRET = 'test-secret'
const { encryptToken, decryptToken } = await import('./token-crypto.ts')

test('zašifrovaný token jde dešifrovat a pokaždé vypadá jinak', () => {
  const t = 'P3et50S9AxdiUXhTMFf6KeGUogDkbcalJ6u9szpmzWI'
  const a = encryptToken(t)
  const b = encryptToken(t)
  assert.notEqual(a, b)
  assert.equal(decryptToken(a), t)
  assert.equal(decryptToken(b), t)
})

test('poškozená nebo cizí data vrátí null', () => {
  const enc = encryptToken('abc')
  const [iv, tag, data] = enc.split('.')
  assert.equal(decryptToken(`${iv}.${tag}.${data.slice(0, -2)}AA`), null)
  assert.equal(decryptToken('nesmysl'), null)
  assert.equal(decryptToken(null), null)
  process.env.MICRO_LINK_SECRET = 'jiny-klic'
  assert.equal(decryptToken(enc), null)
  process.env.MICRO_LINK_SECRET = 'test-secret'
})
