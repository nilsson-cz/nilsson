// lib/mikrozpravy/f3-text.test.ts
// Spuštění: node --test lib/mikrozpravy/*.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MICRO_LINK_SECRET = 'test-secret'
const { escalationSmsText, isAutoReply, parseReplyAddress, replyAddress, stripQuotedReply, toGsmAscii } = await import('./f3-text.ts')

const URL = 'https://nilsson-two.vercel.app/z/P3et50S9AxdiUXhTMFf6KeGUogDkbcalJ6u9szpmzWI'

test('SMS bez diakritiky a vždy do 160 znaků, odkaz celý', () => {
  assert.equal(toGsmAscii('Vlak přijede o 40 min dřív – „ihned"'), 'Vlak prijede o 40 min driv - "ihned"')
  const long = escalationSmsText('Výlet se ruší, autobus nepojede, vyzvedněte prosím děti ve škole do 14:00, děkujeme za pochopení a omlouváme se.', URL)
  assert.ok(long.length <= 160, `délka ${long.length}`)
  assert.ok(long.endsWith(URL))
  assert.ok(long.includes('...'))
  const short = escalationSmsText('Krátká zpráva', URL)
  assert.equal(short, `ZS Vilekula: Kratka zprava Potvrdte: ${URL}`)
})

test('adresa pro odpovědi: tam a zpět, podvrh a jiná doména neprojdou', () => {
  const rid = '18becaab-fae0-46c5-a2d4-77bda232f747'
  const addr = replyAddress(rid, 'odpovedi.zsvilekula.cz')
  assert.match(addr, /^odpoved\+[0-9a-f]{42}@odpovedi\.zsvilekula\.cz$/)
  assert.equal(parseReplyAddress(addr, 'odpovedi.zsvilekula.cz'), rid)
  assert.equal(parseReplyAddress(`Jan Novák <${addr.toUpperCase()}>`, 'odpovedi.zsvilekula.cz'), rid)
  assert.equal(parseReplyAddress(addr.replace(/([0-9a-f])@/, (m, c) => (c === '0' ? '1' : '0') + '@'), 'odpovedi.zsvilekula.cz'), null)
  assert.equal(parseReplyAddress(addr, 'jina.cz'), null)
  assert.equal(parseReplyAddress('nilsson@zsvilekula.cz', 'odpovedi.zsvilekula.cz'), null)
})

test('automatické odpovědi', () => {
  assert.equal(isAutoReply({ 'Auto-Submitted': 'auto-replied' }, 'Re: Gamma'), true)
  assert.equal(isAutoReply({ 'Auto-Submitted': 'no' }, 'Re: Gamma'), false)
  assert.equal(isAutoReply({ Precedence: 'bulk' }, 'Re: Gamma'), true)
  assert.equal(isAutoReply({}, 'Automatická odpověď: Re: Gamma'), true)
  assert.equal(isAutoReply({}, 'Out of Office: Gamma'), true)
  assert.equal(isAutoReply(null, 'Re: Gamma: vlak'), false)
})

test('citace původní zprávy se odřízne', () => {
  assert.equal(stripQuotedReply('Ok, přijde táta.\n\nDne 8. 11. 2026 v 10:00 ZS Vilekula <nilsson@zsvilekula.cz> napsal(a):\n> Vlak má zpoždění'), 'Ok, přijde táta.')
  assert.equal(stripQuotedReply('Díky!\r\n\r\nOn Sat, Nov 8, 2026 at 10:00 AM ZS Vilekula wrote:\r\n> text'), 'Díky!')
  assert.equal(stripQuotedReply('Ano\n-----Original Message-----\nFrom: x'), 'Ano')
  assert.equal(stripQuotedReply('Platí\n--\nJana Nováková\n777 123 456'), 'Platí')
  assert.equal(stripQuotedReply('> jen citace'), '')
  assert.equal(stripQuotedReply('a'.repeat(3000)).length, 2000)
})
