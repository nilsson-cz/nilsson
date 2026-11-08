// lib/mikrozpravy/discord-verify.test.ts
// Spuštění: node --test lib/mikrozpravy/*.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyDiscordSignature } from './discord-verify.ts'

const toHex = (buf: ArrayBuffer) => Buffer.from(buf).toString('hex')

async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const pub = toHex(await crypto.subtle.exportKey('raw', kp.publicKey))
  const sign = async (msg: string) =>
    toHex(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(msg)))
  return { pub, sign }
}

test('platný podpis projde', async () => {
  const { pub, sign } = await keypair()
  const ts = String(Math.floor(Date.now() / 1000))
  const body = '{"type":1}'
  const sig = await sign(ts + body)
  assert.equal(await verifyDiscordSignature({ body, signatureHex: sig, timestamp: ts, publicKeyHex: pub }), true)
})

test('změněné tělo neprojde', async () => {
  const { pub, sign } = await keypair()
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = await sign(ts + '{"type":1}')
  assert.equal(await verifyDiscordSignature({ body: '{"type":2}', signatureHex: sig, timestamp: ts, publicKeyHex: pub }), false)
})

test('starý timestamp (replay) neprojde', async () => {
  const { pub, sign } = await keypair()
  const ts = String(Math.floor(Date.now() / 1000) - 3600)
  const body = '{"type":1}'
  const sig = await sign(ts + body)
  assert.equal(await verifyDiscordSignature({ body, signatureHex: sig, timestamp: ts, publicKeyHex: pub }), false)
})

test('chybějící / nesmyslné hlavičky neprojdou', async () => {
  const { pub } = await keypair()
  const ts = String(Math.floor(Date.now() / 1000))
  assert.equal(await verifyDiscordSignature({ body: '', signatureHex: null, timestamp: ts, publicKeyHex: pub }), false)
  assert.equal(await verifyDiscordSignature({ body: '', signatureHex: 'zz', timestamp: ts, publicKeyHex: pub }), false)
  assert.equal(await verifyDiscordSignature({ body: '', signatureHex: 'ab'.repeat(64), timestamp: 'x', publicKeyHex: pub }), false)
})

test('cizí klíč neprojde', async () => {
  const a = await keypair()
  const b = await keypair()
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = await a.sign(ts + 'x')
  assert.equal(await verifyDiscordSignature({ body: 'x', signatureHex: sig, timestamp: ts, publicKeyHex: b.pub }), false)
})
