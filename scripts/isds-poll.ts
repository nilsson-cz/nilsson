/**
 * scripts/isds-poll.ts
 *
 * Denní cron job (GitHub Actions, viz .github/workflows/essl-isds-poll.yml).
 * Stahuje seznam přijatých zpráv z datové schránky školy (rm35wuu) přes
 * ISDS SOAP rozhraní, ukládá je do ds_zpravy (raw payload + dedup) a
 * namapuje nové zprávy do dokumenty (eSSL evidence). Posílá Discord
 * notifikaci na #administrativa za každou novou zprávu.
 *
 * Spouští se přes: npx tsx scripts/isds-poll.ts
 *
 * Env proměnné:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ISDS_CERT_PEM              — systémový certifikát spisové služby (PEM, base64)
 *   ISDS_KEY_PEM               — privátní klíč k certifikátu (PEM, base64)
 *   ISDS_BASE_URL              — volitelné, default https://ws1c.mojedatovaschranka.cz/cert
 *   DISCORD_ADMINISTRATIVA_WEBHOOK_URL
 *
 * ISDS kontrakt (viz ARCH-NOTES §84–§85):
 *   Přístup spisové agendy systémovým certifikátem (mTLS), baseURL:
 *     https://ws1c.mojedatovaschranka.cz/cert
 *   GetListOfReceivedMessages → <baseURL>/DS/dx  (dmInfoWebService)
 *   MessageDownload           → <baseURL>/DS/dz  (dmOperationsWebService)
 *   Autentizace: klientský certifikát (mTLS), přihlašovací jméno se nepoužívá.
 *
 * Design rozhodnutí (viz ARCH-NOTES §pro eSSL fázi 2):
 *   - dmFromTime = teď − 7 dní (překryv kvůli případnému výpadku cronu),
 *     skutečná deduplikace řeší UNIQUE (ds_zprava_id) v ds_zpravy.
 *   - dmStatusFilter = '' (bez filtru).
 *   - MarkMessageAsDownloaded se NEVOLÁ — nechceme ovlivnit "přečteno"
 *     stav v ISDS, když si zprávu někdo přečte i přes portál Datovka.
 *   - Neznámý odesílatel (nenalezen v jmenny_rejstrik dle dbIDSender)
 *     se NEVKLÁDÁ automaticky — subjekt_id zůstává NULL,
 *     subjekt_nazev_cache = dmSender. Ruční přiřazení na detailu dokumentu.
 */

import https from 'node:https'
import { createClient } from '@supabase/supabase-js'
import { XMLParser } from 'fast-xml-parser'

// ---------------------------------------------------------------------------
// Konfigurace
// ---------------------------------------------------------------------------

// Přístup spisové agendy systémovým certifikátem → host ws1c + prefix /cert.
// baseURL lze přepsat přes env (bez zásahu do kódu), || kvůli prázdné GH var.
const ISDS_BASE_URL = process.env.ISDS_BASE_URL || 'https://ws1c.mojedatovaschranka.cz/cert'
const ISDS_INFO_URL = `${ISDS_BASE_URL}/DS/dx`
const NS = 'http://isds.czechpoint.cz/v20'
const POLL_WINDOW_DAYS = 7

const DISCORD_WEBHOOK = process.env.DISCORD_ADMINISTRATIVA_WEBHOOK_URL
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nilsson-two.vercel.app'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Chybí povinná env proměnná: ${name}`)
  }
  return value
}

const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY')
)

const ISDS_CERT_PEM = Buffer.from(requireEnv('ISDS_CERT_PEM'), 'base64').toString('utf8')
const ISDS_KEY_PEM = Buffer.from(requireEnv('ISDS_KEY_PEM'), 'base64').toString('utf8')

// mTLS agent — klientský certifikát spisové služby. ISDS podle něj identifikuje
// spisovou službu; přihlašovací jméno se nepoužívá.
const isdsAgent = new https.Agent({
  cert: ISDS_CERT_PEM,
  key: ISDS_KEY_PEM,
  keepAlive: true,
})

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
})

// ---------------------------------------------------------------------------
// Typy odpovídající dmBaseTypes.xsd (jen pole, která používáme)
// ---------------------------------------------------------------------------

interface DmRecord {
  dmID: string // bigint jako string – JS number by mohl ztratit přesnost
  dbIDSender?: string
  dmSender?: string
  dmSenderAddress?: string
  dmAnnotation?: string
  dmDeliveryTime?: string
  dmAcceptanceTime?: string
  dmMessageStatus?: string | number
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// SOAP volání
// ---------------------------------------------------------------------------

// HTTPS POST přes mTLS agenta (klientský certifikát). Node core `https`,
// žádná externí závislost — fetch/undici by pro klientský cert potřeboval
// vlastní dispatcher navíc.
function httpsPost(
  urlStr: string,
  body: string,
  headers: Record<string, string>
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: u.pathname + u.search,
        method: 'POST',
        agent: isdsAgent,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }))
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function soapCall(url: string, bodyXml: string): Promise<any> {
  // SOAP obálku skládáme ručně šablonou (bodyXml je už hotový XML fragment,
  // XMLBuilder z objektu by ho musel escapovat jako text, což nechceme):
  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    ${bodyXml}
  </soap:Body>
</soap:Envelope>`

  const { status, text } = await httpsPost(url, soapEnvelope, {
    'Content-Type': 'text/xml; charset=utf-8',
    SOAPAction: '',
  })

  if (status < 200 || status >= 300) {
    throw new Error(`ISDS SOAP chyba (${url}): HTTP ${status} — ${text.slice(0, 500)}`)
  }

  return xmlParser.parse(text)
}

// ---------------------------------------------------------------------------
// 1. GetListOfReceivedMessages
// ---------------------------------------------------------------------------

async function fetchReceivedMessages(): Promise<DmRecord[]> {
  const toTime = new Date()
  const fromTime = new Date(toTime.getTime() - POLL_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const bodyXml = `<GetListOfReceivedMessages xmlns="${NS}">
    <dmFromTime>${fromTime.toISOString()}</dmFromTime>
    <dmToTime>${toTime.toISOString()}</dmToTime>
    <dmRecipientOrgUnitNum xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
    <dmStatusFilter></dmStatusFilter>
    <dmOffset xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
    <dmLimit xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
  </GetListOfReceivedMessages>`

  const parsed = await soapCall(ISDS_INFO_URL, bodyXml)

  const responseBody =
    parsed?.Envelope?.Body?.GetListOfReceivedMessagesResponse ??
    parsed?.Envelope?.Body?.['GetListOfReceivedMessagesResponse']

  const statusCode = responseBody?.dmStatus?.dmStatusCode
  const statusMessage = responseBody?.dmStatus?.dmStatusMessage

  if (statusCode && !String(statusCode).startsWith('00')) {
    throw new Error(`ISDS GetListOfReceivedMessages selhalo: ${statusCode} — ${statusMessage}`)
  }

  const records = responseBody?.dmRecords?.dmRecord
  if (!records) return []

  // fast-xml-parser vrací objekt (ne pole), pokud je jen jeden záznam
  return Array.isArray(records) ? records : [records]
}

// ---------------------------------------------------------------------------
// 2. Uložení do ds_zpravy (dedup přes UNIQUE ds_zprava_id)
// ---------------------------------------------------------------------------

async function storeRawMessage(record: DmRecord): Promise<{ inserted: boolean; id: string | null }> {
  const dmId = BigInt(record.dmID) // ochrana proti ztrátě přesnosti u velkých ID

  const { data, error } = await supabase
    .from('ds_zpravy')
    .insert({
      ds_zprava_id: dmId.toString(),
      typ_zpravy: 'zprava',
      odesilatel_nazev: record.dmSender ?? null,
      odesilatel_id_ds: record.dbIDSender ?? null,
      predmet: record.dmAnnotation ?? null,
      datum_dodani: record.dmDeliveryTime ?? record.dmAcceptanceTime ?? null,
      raw_payload: record,
      zpracovano: false,
    } as any)
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      // Už zpracováno v předchozím běhu (překryvové okno) — v pořádku, přeskočit.
      return { inserted: false, id: null }
    }
    console.error(`[isds-poll] ds_zpravy INSERT chyba (dmID ${dmId}):`, error)
    return { inserted: false, id: null }
  }

  return { inserted: true, id: (data as any).id }
}

// ---------------------------------------------------------------------------
// 3. Mapování ds_zpravy → dokumenty + jmenny_rejstrik lookup
// ---------------------------------------------------------------------------

async function mapToDokumenty(dsZpravaId: string, record: DmRecord): Promise<void> {
  // Lookup subjektu podle DS ID odesílatele. Pokud nenalezen, NEVKLÁDÁME
  // automaticky (viz design rozhodnutí v hlavičce souboru).
  let subjektId: string | null = null
  const subjektNazevCache = record.dmSender ?? null

  if (record.dbIDSender) {
    const { data: subjekt } = await supabase
      .from('jmenny_rejstrik')
      .select('id')
      .eq('id_ds', record.dbIDSender)
      .maybeSingle()

    if (subjekt) {
      subjektId = (subjekt as any).id
    }
  }

  const datumPrijeti = record.dmAcceptanceTime ?? record.dmDeliveryTime
    ? new Date(record.dmAcceptanceTime ?? record.dmDeliveryTime!).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  const { data: dokument, error: dokErr } = await supabase
    .from('dokumenty')
    .insert({
      smer: 'prijaty',
      subjekt_id: subjektId,
      subjekt_nazev_cache: subjektNazevCache,
      ds_zprava_id: BigInt(record.dmID).toString(),
      predmet: record.dmAnnotation || '(bez předmětu)',
      zpusob_doruceni: 'datova_schranka',
      datum_prijeti: datumPrijeti,
      stav: 'prijat',
    } as any)
    .select('id, cislo_jednaci')
    .single()

  if (dokErr) {
    console.error(`[isds-poll] dokumenty INSERT chyba (ds_zpravy ${dsZpravaId}):`, dokErr)
    await supabase
      .from('ds_zpravy')
      .update({ chyba: dokErr.message })
      .eq('id', dsZpravaId)
    return
  }

  const dokumentId = (dokument as any).id
  const cisloJednaci = (dokument as any).cislo_jednaci

  await supabase
    .from('ds_zpravy')
    .update({ zpracovano: true, dokument_id: dokumentId })
    .eq('id', dsZpravaId)

  const { error: auditErr } = await supabase.rpc('essl_log', {
    p_operace: 'dokument_prijat',
    p_dokument_id: dokumentId,
    p_detail: { zdroj: 'isds-poll', ds_zprava_id: record.dmID },
    p_uzivatel_popis_override: 'ISDS cron',
  })
  if (auditErr) {
    // Audit nesmí selhat potichu — essl_transakce je zákonná append-only stopa.
    console.error(`[isds-poll] essl_log selhalo (dokument ${dokumentId}):`, auditErr)
    throw new Error(`essl_log selhalo: ${auditErr.message}`)
  }

  await sendDiscordNotification({
    predmet: record.dmAnnotation || '(bez předmětu)',
    odesilatel: record.dmSender ?? 'neznámý odesílatel',
    cisloJednaci,
    dokumentId,
  })
}

// ---------------------------------------------------------------------------
// 4. Discord notifikace — jedna zpráva na jeden nový dokument
// ---------------------------------------------------------------------------

async function sendDiscordNotification(params: {
  predmet: string
  odesilatel: string
  cisloJednaci: string
  dokumentId: string
}): Promise<void> {
  if (!DISCORD_WEBHOOK) {
    console.log('[isds-poll] DISCORD_ADMINISTRATIVA_WEBHOOK_URL není nastaven, notifikace přeskočena.')
    return
  }

  const content = [
    `📥 **Nová zpráva z datové schránky**`,
    `Č. j.: ${params.cisloJednaci}`,
    `Odesílatel: ${params.odesilatel}`,
    `Předmět: ${params.predmet}`,
    `${APP_URL}/dashboard/spisovka/${params.dokumentId}`,
  ].join('\n')

  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) {
      console.error('[isds-poll] Discord webhook chyba:', res.status, await res.text())
    }
  } catch (err) {
    console.error('[isds-poll] Discord webhook výjimka:', err)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[isds-poll] Start, okno ${POLL_WINDOW_DAYS} dní.`)

  const records = await fetchReceivedMessages()
  console.log(`[isds-poll] ISDS vrátil ${records.length} zpráv v okně.`)

  let novych = 0
  let duplicit = 0
  let chyb = 0

  for (const record of records) {
    const { inserted, id } = await storeRawMessage(record)

    if (!inserted) {
      duplicit++
      continue
    }

    novych++

    try {
      await mapToDokumenty(id!, record)
    } catch (err) {
      chyb++
      console.error(`[isds-poll] Mapování selhalo (dmID ${record.dmID}):`, err)
    }
  }

  console.log(`[isds-poll] Hotovo: ${novych} nových, ${duplicit} duplicit, ${chyb} chyb.`)
}

main().catch((err) => {
  console.error('[isds-poll] Fatální chyba:', err)
  process.exit(1)
})
