/**
 * lib/sms.ts
 * Odesílání SMS přes bránu SMSbrána.cz (služba SMSConnect, HTTP API).
 *
 * Zabezpečení AUTH_HASH (typ 2, doporučené): přenáší se jen kontrolní hash,
 * heslo nikdy neputuje v URL. hash = md5(password + time + salt).
 * Endpoint, salt i výpočet dle oficiálního repo smsbrana/sms-connect.
 *
 * Env (Vercel / GitHub Actions secrets):
 *   SMSBRANA_LOGIN     — login služby SMSConnect
 *   SMSBRANA_PASSWORD  — heslo služby SMSConnect (NE heslo do webu)
 *
 * Kredit je předplacený (žádný fixní měsíční poplatek) — platí se za odeslané SMS.
 */

import { createHash, randomInt } from 'node:crypto'

const API_URL = 'https://api.smsbrana.cz/smsconnect/http.php'

export interface SmsResult {
  ok: boolean
  /** kód err z odpovědi (0 = OK) nebo popis chyby pro log */
  detail: string
}

/** date("c") ekvivalent — ISO 8601 s offsetem, bez milisekund (v UTC). */
function isoTime(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

/**
 * Salt („sůl") přesně dle oficiální knihovny: 13 znaků z [0-9a-z].
 * Pozor: brána si přepočítává md5 z PŘIJATÉHO saltu — nestandardní formát/délka
 * (dřív 16 hex znaků z randomBytes) může vést k neshodě hashe → err=3.
 */
function makeSalt(length = 13): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
  let s = ''
  for (let i = 0; i < length; i++) s += chars[randomInt(chars.length)]
  return s
}

/** Číselník chyb SMSConnect (element <err>). 0 = OK. */
const ERR_MESSAGES: Record<string, string> = {
  '1': 'neznámá chyba brány',
  '2': 'neplatný login nebo heslo',
  '3': 'neplatný login nebo heslo (ověřte SMS Connect heslo a zapnuté pokročilé/hash přihlášení)',
  '4': 'časová známka mimo toleranci',
  '5': 'nepovolená IP adresa',
  '8': 'chyba databáze brány',
  '9': 'nedostatečný kredit',
  '10': 'neplatné číslo příjemce',
  '11': 'prázdný text zprávy',
  '12': 'text je příliš dlouhý',
}

type AuthParams = { login: string; time: string; sul: string; hash: string }

/** Sestaví autentizační parametry (login/time/sul/hash) z env. */
function buildAuth(): { params: AuthParams } | { error: string } {
  // Trim proti copy-paste artefaktům v env (trailing newline/mezera by rozbily hash).
  const login = process.env.SMSBRANA_LOGIN?.trim()
  const password = process.env.SMSBRANA_PASSWORD?.trim()
  if (!login || !password) return { error: 'Chybí SMSBRANA_LOGIN / SMSBRANA_PASSWORD.' }

  const time = isoTime()
  const sul = makeSalt()
  const hash = createHash('md5').update(password + time + sul).digest('hex')
  return { params: { login, time, sul, hash } }
}

/**
 * Přeloží odpověď brány na výsledek. Dle kontraktu SMSConnect je úspěch, když
 * je <err> nula NEBO úplně chybí (např. akce inbox vrací rovnou <result><inbox>…
 * bez <err>). Chyba = jen nenulový číselný kód. Neznámé tělo bez <result> je chyba.
 */
function parseErr(body: string): SmsResult {
  const m = body.match(/<err>\s*(\d+)\s*<\/err>/i)
  const err = m?.[1] ?? null
  if (err === '0') return { ok: true, detail: 'err=0' }
  if (err !== null) return { ok: false, detail: `err=${err} — ${ERR_MESSAGES[err] ?? 'neznámý kód'}` }
  if (/<result[\s>]/i.test(body)) return { ok: true, detail: 'OK (bez chyby)' }
  return { ok: false, detail: `neočekávaná odpověď: ${body.slice(0, 300)}` }
}

/**
 * Odešle jednu SMS. Nikdy nevyhazuje — chybu vrací v `ok=false` + `detail`,
 * aby výpadek brány nezhavaroval cron (ten si chybu zaloguje a odešle alert).
 */
export async function sendSms(opts: { number: string; message: string }): Promise<SmsResult> {
  const auth = buildAuth()
  if ('error' in auth) return { ok: false, detail: auth.error }

  const number = opts.number.replace(/\s+/g, '')
  if (!number) return { ok: false, detail: 'Prázdné cílové číslo.' }

  const params = new URLSearchParams({
    action: 'send_sms',
    ...auth.params,
    number,
    message: opts.message,
  })

  try {
    const res = await fetch(`${API_URL}?${params.toString()}`, { method: 'GET' })
    const body = (await res.text()).trim()
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 300)}` }
    return parseErr(body)
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** Zavolá read-only akci `inbox` s danými parametry a přeloží <err>. */
async function callInbox(params: URLSearchParams): Promise<SmsResult> {
  try {
    const res = await fetch(`${API_URL}?${params.toString()}`, { method: 'GET' })
    const body = (await res.text()).trim()
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` }
    return parseErr(body)
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Diagnostika přihlášení k bráně — akcí `inbox` (NEodesílá SMS, nestojí kredit).
 * Zkusí HASH přihlášení; když selže, zkusí PLAIN (heslo v URL, jen přes HTTPS) —
 * tím odliší „profil je na plain přihlášení" od „login/heslo jsou špatně".
 * Vrací i délky env hodnot (ne obsah).
 */
export async function checkSmsAuth(): Promise<{ ok: boolean; detail: string; envInfo: string }> {
  const login = process.env.SMSBRANA_LOGIN?.trim()
  const password = process.env.SMSBRANA_PASSWORD?.trim()
  const envInfo =
    `login: ${login ? `nastaven (${login.length} zn.)` : 'CHYBÍ'}, ` +
    `heslo: ${password ? `nastaveno (${password.length} zn.)` : 'CHYBÍ'}`
  if (!login || !password) {
    return { ok: false, detail: 'Chybí SMSBRANA_LOGIN / SMSBRANA_PASSWORD.', envInfo }
  }

  // 1) HASH (pokročilé přihlášení)
  const time = isoTime()
  const sul = makeSalt()
  const hash = createHash('md5').update(password + time + sul).digest('hex')
  const hashRes = await callInbox(new URLSearchParams({ action: 'inbox', login, time, sul, hash }))
  if (hashRes.ok) return { ok: true, detail: 'Přihlášení OK (hash).', envInfo }

  // 2) PLAIN fallback — jen diagnostika, heslo přes HTTPS
  const plainRes = await callInbox(new URLSearchParams({ action: 'inbox', login, password }))
  if (plainRes.ok) {
    return {
      ok: false,
      detail: `hash: ${hashRes.detail}; PLAIN ale funguje → profil SMS Connect NEMÁ zapnuté pokročilé/hash přihlášení. Zapni ho na smsbrana.cz, nebo přepneme kód na plain.`,
      envInfo,
    }
  }
  return {
    ok: false,
    detail: `hash: ${hashRes.detail}; plain: ${plainRes.detail} → login/heslo jsou nejspíš špatně (ověř SMS Connect heslo, ne heslo do webu).`,
    envInfo,
  }
}

/**
 * Text denního reportu jídelně s rozkladem na dvě věkové skupiny dle vyhlášky
 * o školním stravování:
 *   „Vilekula obedy DD.MM.: 18+24 = 42 obedu (mladsi+starsi)"
 * mladsi = do 11 let, starsi = 11+ (věk dosažený ve školním roce). Bez
 * diakritiky (1 SMS segment).
 */
export function lunchReportMessage(menuDate: string, younger: number, older: number): string {
  const [, mm, dd] = menuDate.split('-') // menuDate = YYYY-MM-DD
  const total = younger + older
  return `Vilekula obedy ${dd}.${mm}.: ${younger}+${older} = ${total} obedu (mladsi+starsi)`
}
