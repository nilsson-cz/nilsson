// lib/spz-xml.ts
// Čtení elektronického doporučení ŠPZ (XML formulář Software602, ns software602.cz/sample),
// které poradna posílá škole spolu se zprávou.
//
// Běží v PROHLÍŽEČI: XML obsahuje diagnózy a údaje zákonných zástupců (GDPR čl. 9),
// na server se posílají jen vytažené údaje pro matriku. Soubor se nikde neukládá.
// Bez Supabase a server-only závislostí.

import { XMLParser } from 'fast-xml-parser'
import type { Doporuceni, PodpurneOpatreni } from '@/lib/vp-doporuceni-shared'

export interface SpzXmlVysledek {
  doporuceni: Omit<Doporuceni, 'student_id' | 'care_id'>
  /** Údaje o klientovi pro kontrolu, že doporučení patří k žákovi (neukládají se). */
  klient: { jmeno: string; prijmeni: string; datum_narozeni: string | null }
  /** Upozornění k ruční kontrole (neznámé hodnoty, chybějící údaje). */
  upozorneni: string[]
}

type Node = Record<string, unknown>

function txt(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function get(node: unknown, ...path: string[]): unknown {
  let cur: unknown = node
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Node)[p]
  }
  return cur
}

/** „8.7.2026“ → „2026-07-08“; neplatné → null. */
export function czDatum(v: unknown): string | null {
  const m = txt(v).match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/)
  if (!m) return null
  const [, d, mo, y] = m
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  const dt = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso
}

/** „5.2028“ (měsíc.rok) → „2028-05-01“; plné datum také projde. */
export function czMesic(v: unknown): string | null {
  const full = czDatum(v)
  if (full) return full
  const m = txt(v).match(/^(\d{1,2})\.\s*(\d{4})/)
  if (!m) return null
  const mo = Number(m[1])
  return mo >= 1 && mo <= 12 ? `${m[2]}-${String(mo).padStart(2, '0')}-01` : null
}

function cislo(v: unknown): number | null {
  const s = txt(v).replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** „AsistentPedagoga“ → „asistent_pedagoga“ */
function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/** Projde strom PO a vrátí každý prvek, který má technický kód NFN (KodTnfn). */
function najdiOpatreni(node: unknown, name: string, out: { name: string; node: Node }[]) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => najdiOpatreni(n, name, out)); return }
  const n = node as Node
  if ('KodTnfn' in n) { out.push({ name, node: n }); return }
  for (const [k, v] of Object.entries(n)) najdiOpatreni(v, k, out)
}

function mapIvp(v: string, upozorneni: string[]): Doporuceni['indi'] {
  const s = v.toLowerCase()
  if (!s || s.startsWith('bez')) return '0'
  if (s.includes('nad')) return '5'           // mimořádné nadání
  if (s.includes('ivp')) return '1'
  upozorneni.push(`Neznámá hodnota IVP „${v}“ — zkontrolujte položku IVP.`)
  return '0'
}

/**
 * Přečte XML doporučení ŠPZ. Vyhodí Error, pokud soubor není formulář doporučení.
 */
export function parseSpzXml(xml: string): SpzXmlVysledek {
  const parser = new XMLParser({
    removeNSPrefix:   true,
    ignoreAttributes: true,
    parseTagValue:    false,   // kódy s úvodními nulami nechat jako text
    trimValues:       true,
    processEntities:  false,
  })
  const root = parser.parse(xml) as Node
  const data = get(root, 'root', 'data')
  const souhrn = get(data, 'DoporuceniSpzSSzPriTezeSkole', 'SouhrnneUdajeVysetreniStanovenymPo')
  if (!data || !souhrn) {
    throw new Error('Soubor nevypadá jako elektronické doporučení ŠPZ (chybí souhrnné údaje o PO).')
  }

  const upozorneni: string[] = []
  const evid = get(data, 'AdministrativniUdaje', 'EvidencniInformaceSpz')
  const klient = get(data, 'Klient')

  const pspo = Number(txt(get(souhrn, 'PrevazujiciStupenPo')))
  const idZnev = txt(get(souhrn, 'IdentifikatorZnevyhodneni', 'Siz')).toUpperCase() || null
  const dalsi = txt(get(souhrn, 'DalsiZnevyhodneni', 'Siz')).toUpperCase()
  const datumVydani = czDatum(get(evid, 'DatumZpravyDoporuceni'))
  const platnostOd = czDatum(get(souhrn, 'NavrhPoskytovaniOpatreni', 'Od')) ?? datumVydani
  const izo = txt(get(evid, 'IzoSpz'))

  if (!(pspo >= 1 && pspo <= 5)) upozorneni.push('V XML chybí převažující stupeň PO.')
  if (!platnostOd) upozorneni.push('V XML chybí datum zahájení poskytování opatření — doplňte „Platnost od“.')
  if (txt(get(evid, 'NaseZnSkole')) === '' ) upozorneni.push('V XML chybí číslo jednací.')

  const nalezene: { name: string; node: Node }[] = []
  najdiOpatreni(get(data, 'DoporuceniSpzSSzPriTezeSkole', 'PodpurnaOpatreni'), 'PodpurnaOpatreni', nalezene)
  najdiOpatreni(get(data, 'DoporuceniSpzSSzPriTezeSkole', 'PodpurnaOpatreniJinehoDruhu'), 'PodpurnaOpatreniJinehoDruhu', nalezene)

  const opatreni: PodpurneOpatreni[] = nalezene
    .filter(({ node }) => {
      const z = txt(node.Zaskrtnuto).toLowerCase()
      return (z === '' || z === 'ano') && txt(node.KodTnfn) !== ''
    })
    .map(({ name, node }) => {
      const zdroj = txt(node.ZdrojFinancovani).toUpperCase()
      const zdrojFin = zdroj === 'NFN' || zdroj === 'PNFN' ? zdroj : null
      if (zdroj && !zdrojFin) upozorneni.push(`${name}: neznámý zdroj financování „${zdroj}“.`)
      const od = czDatum(node.Od)
      return {
        druh:              snake(name),
        stupen:            cislo(node.Stupen),
        pocet_jednotek:    cislo(node.PocetJednotek),
        zdroj_financovani: zdrojFin,
        kod_nfn:           txt(node.KodTnfn).toUpperCase(),
        fpp:               null,
        // FN = škola požaduje finanční prostředky; předvyplněno podle zdroje, VP ověří.
        fn:                zdrojFin === 'NFN' ? '1' : '0',
        datum_zahajeni:    od,
        datum_ukonceni:    czDatum(node.Do),
        // Skutečné zahájení = navrhované; VP potvrdí nebo opraví (PLAT_ZAC souboru „b“).
        poskytovano_od:    od,
        poskytovano_do:    null,
        poznamka:          null,
      } satisfies PodpurneOpatreni
    })

  return {
    doporuceni: {
      izo_spz:         /^\d{9}$/.test(izo) ? izo : null,
      cislo_jednaci:   txt(get(evid, 'NaseZnSkole')) || null,
      datum_vydani:    datumVydani,
      platnost_od:     platnostOd ?? '',
      platnost_do:     czDatum(get(souhrn, 'PlatnostDoporuceniDo')),
      ukonceno_k:      null,
      termin_kontroly: czMesic(get(souhrn, 'TerminKontrolnihoVysetreni')),
      pspo:            pspo >= 1 && pspo <= 5 ? pspo : 2,
      id_znev:         idZnev,
      id_znev_dalsi:   dalsi && !/^0+$/.test(dalsi) ? dalsi : null,
      indi:            mapIvp(txt(get(souhrn, 'NavrhOrganizacniFormyVzdelani', 'Ivp')), upozorneni),
      uvp:             '0',
      upr_vyst:        false,
      prodl_dv:        0,
      stav:            'platne',
      poznamka:        null,
      zdroj:           'xml',
      opatreni,
    },
    klient: {
      jmeno:          txt(get(klient, 'Jmeno')),
      prijmeni:       txt(get(klient, 'Prijmeni')),
      datum_narozeni: czDatum(get(klient, 'DatumNarozeni')),
    },
    upozorneni,
  }
}
