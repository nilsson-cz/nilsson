// Spuštění: npx tsx --test lib/cron-auth.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCronAuthorized } from './cron-auth'

const req = (auth?: string) =>
  new Request('https://x.test/api/cron/x', auth === undefined ? {} : { headers: { authorization: auth } })

test('bez CRON_SECRET odmítne vše, i „Bearer undefined"', () => {
  delete process.env.CRON_SECRET
  assert.equal(isCronAuthorized(req('Bearer undefined')), false)
  assert.equal(isCronAuthorized(req('Bearer ')), false)
  assert.equal(isCronAuthorized(req()), false)
})

test('s CRON_SECRET pustí jen správnou hlavičku', () => {
  process.env.CRON_SECRET = 's3cret'
  assert.equal(isCronAuthorized(req('Bearer s3cret')), true)
  assert.equal(isCronAuthorized(req('Bearer spatne')), false)
  assert.equal(isCronAuthorized(req('s3cret')), false)
  assert.equal(isCronAuthorized(req()), false)
})
