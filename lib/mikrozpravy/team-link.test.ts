// lib/mikrozpravy/team-link.test.ts
// Spuštění: node --test lib/mikrozpravy/*.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MICRO_LINK_SECRET = 'test-secret'
const { signTeamLink, verifyTeamLink, TEAM_LINK_TTL_MS } = await import('./team-link.ts')

test('podepsaný odkaz projde a nese id zprávy', () => {
  const sig = signTeamLink('abc', 1000)
  assert.deepEqual(verifyTeamLink(sig, 2000), { messageId: 'abc', exp: 1000 + TEAM_LINK_TTL_MS })
})

test('po expiraci neprojde', () => {
  const sig = signTeamLink('abc', 1000)
  assert.equal(verifyTeamLink(sig, 1000 + TEAM_LINK_TTL_MS + 1), null)
})

test('podvržený obsah nebo podpis neprojde', () => {
  const sig = signTeamLink('abc', 1000)
  const [, macPart] = sig.split('.')
  const forged = Buffer.from(JSON.stringify({ m: 'jina-zprava', exp: 9e15 })).toString('base64url')
  assert.equal(verifyTeamLink(`${forged}.${macPart}`, 2000), null)
  assert.equal(verifyTeamLink(sig.slice(0, -2) + 'xx', 2000), null)
  assert.equal(verifyTeamLink('nesmysl', 2000), null)
})
