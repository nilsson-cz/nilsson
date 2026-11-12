/**
 * lib/manazerske-ucetnictvi/kontrola-server.ts
 * Načtení dat pro Kontrolu (banka 221 vs. FIO, pokladna 211 vs. inventura).
 */

import { fetchAll, loadVfReport } from '@/lib/verejne-finance'
import { abraConfigFromEnv, fetchBankaNezauctovane } from './abra-client'
import { parsePeriod } from '@/lib/vykaz-ku'
import { lastDay, nextPeriod, zustatekKDni, type Snapshot, type Tx } from './cashflow'
import { dnesPraha } from './cashflow-server'
import type { MuSupabase } from './report'
import {
  bankovniDoklady, nezauctovanyDoklad, prijataDotace, sparovat, zustatekUctu,
  type BankDoklad, type FioPohyb, type KontrolaRadek, type PocatekZdroj,
} from './kontrola'

export const TOLERANCE_DNI = 3
/** Pohyby z FIO mladší než tolik dní se nehlásí jako chyba — účetní je ještě nemusela zaúčtovat. */
export const CERSTVE_DNI = 14

export type KontrolaMesic = {
  period: string
  datum: string
  abra: number
  fio: number | null
  rozdil: number | null
}

export type KontrolaReport = {
  rok: number
  dnes: string
  abraData: boolean
  fioOd: string | null                      // první importovaný pohyb FIO
  banka: { mesice: KontrolaMesic[]; pocatekZdroj: PocatekZdroj; pocatekRucne: number | null }
  pohyby: {
    sparovano: number
    jenFio: (FioPohyb & { cerstvy: boolean })[]          // v ABRA chybí úplně (nebo se nezaúčtované nepodařilo načíst)
    nezauctovano: { fio: FioPohyb & { cerstvy: boolean }; doklad: BankDoklad }[]   // v ABRA je, jen nezaúčtovaný
    nezauctovanoChyba: string | null                     // ABRA nedostupná / nenastavená → nezaúčtované nerozlišeny
    jenAbra: BankDoklad[]
  }
  pokladna: {
    mesice: { period: string; datum: string; zustatek: number }[]
    pocatekZdroj: PocatekZdroj
    pocatekRucne: number | null
    inventury: { id: string; datum: string; castka: number; abra: number; rozdil: number; poznamka: string | null }[]
  }
  dotace: {
    ucet: string
    mesice: { period: string; prijato: number; narok: number | null; kumPrijato: number; kumNarok: number | null; rozdil: number | null }[]
    poZakazkach: { zakazka: string; prijato: number }[]
    narokPoPolozkach: { nazev: string; narok: number }[]
    narokChyba: string | null
  }
  souhrn: {
    bankaRozdil: number | null
    nezauctovanoSuma: number | null           // součet nezaúčtovaných bankovních dokladů (příjem +, výdej −)
    bankaRozdilPoZauctovani: number | null    // bankaRozdil + nezauctovanoSuma
    nesparovano: number
    nezauctovano: number
    pokladnaZaporna: string[]
    inventuraRozdil: number | null
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100

const dniZpet = (datum: string, n: number) => {
  const d = new Date(`${datum}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export async function loadKontrola(sb: MuSupabase, rok?: number, now = new Date()): Promise<KontrolaReport> {
  const dnes = dnesPraha(now)
  const r = rok ?? Number(dnes.slice(0, 4))
  const od = `${r}-01-01`
  const konec = `${r}-12-31` < dnes ? `${r}-12-31` : dnes

  const { data: nast } = await sb.from('mu_nastaveni').select('*').eq('id', 1).maybeSingle()
  const dotUcet = /^[0-9]{1,6}$/.test(nast?.dotace_ucet ?? '') ? (nast?.dotace_ucet as string) : '346'

  const [radky, pocatky, inv, snaps, prvniTx] = await Promise.all([
    fetchAll<KontrolaRadek & { zakazka: string | null }>(() =>
      sb.from('mu_abra_radek')
        .select('flexi_id, dat_ucto, md_ucet, dal_ucet, castka, doklad, id_dokl, evidence_path, popis, firma, smazano, zuctovano, zakazka')
        .eq('rok', r).eq('smazano', false)
        .or(`md_ucet.like.221*,dal_ucet.like.221*,md_ucet.like.211*,dal_ucet.like.211*,md_ucet.like.${dotUcet}*,dal_ucet.like.${dotUcet}*`)
        .order('flexi_id')),
    sb.from('mu_kontrola_pocatek').select('ucet, castka').eq('rok', r),
    sb.from('mu_kontrola_inventura').select('id, datum, castka, poznamka').gte('datum', od).lte('datum', `${r}-12-31`).order('datum', { ascending: false }),
    sb.from('mu_ucet_zustatek').select('datum, zustatek').order('datum'),
    sb.from('payment_transactions').select('transaction_date').order('transaction_date').limit(1),
  ])
  if (pocatky.error) throw new Error(pocatky.error.message)
  if (inv.error) throw new Error(inv.error.message)
  const rows = radky.map((x) => ({ ...x, flexi_id: Number(x.flexi_id), castka: Number(x.castka), id_dokl: x.id_dokl === null ? null : Number(x.id_dokl) }))
  const pocatek = (u: '221' | '211') => {
    const p = (pocatky.data ?? []).find((x) => x.ucet === u)
    return p ? Number(p.castka) : null
  }
  const snapshots: Snapshot[] = (snaps.data ?? []).map((s) => ({ datum: s.datum, zustatek: Number(s.zustatek) }))
  const fioOd = prvniTx.data?.[0]?.transaction_date?.slice(0, 10) ?? null

  const txRows = await fetchAll<{ id: string; transaction_date: string; amount: number; counterparty_name: string | null; note: string | null }>(() =>
    sb.from('payment_transactions').select('id, transaction_date, amount, counterparty_name, note')
      .gte('transaction_date', dniZpet(od, TOLERANCE_DNI)).order('transaction_date').order('id'))
  const txs: Tx[] = txRows.map((t) => ({ datum: t.transaction_date.slice(0, 10), castka: Number(t.amount) }))

  // Měsíce roku do dneška.
  const periods: string[] = []
  for (let p = `${r}-01`; p <= konec.slice(0, 7); p = nextPeriod(p)) periods.push(p)

  // Banka: zůstatek 221 vs. FIO ke konci měsíce (aktuální měsíc k dnešku).
  // Před začátkem importu FIO jen tam, kde je zůstatek přesně k tomu dni (ruční z výpisu).
  const snapDny = new Set(snapshots.map((s) => s.datum))
  const banka = periods.map((p) => {
    const datum = lastDay(p) < konec ? lastDay(p) : konec
    const abra = zustatekUctu(rows, '221', r, datum, pocatek('221'))
    const fio = (fioOd && datum >= fioOd) || snapDny.has(datum) ? zustatekKDni(datum, snapshots, txs) : null
    return { period: p, datum, abra: abra.zustatek, fio, rozdil: fio === null ? null : Math.round((abra.zustatek - fio) * 100) / 100, zdroj: abra.pocatekZdroj }
  })

  // Pohyby: jen od začátku importu FIO (dřívější doklady ABRA nemají s čím se párovat).
  const parovatOd = fioOd && fioOd > od ? fioOd : od
  const fioPohyby: FioPohyb[] = txRows
    .filter((t) => t.transaction_date.slice(0, 10) >= parovatOd && t.transaction_date.slice(0, 10) <= konec)
    .map((t) => ({ id: t.id, datum: t.transaction_date.slice(0, 10), castka: Number(t.amount), protistrana: t.counterparty_name, poznamka: t.note }))
  const docs = bankovniDoklady(rows).filter((d) => d.datum >= dniZpet(parovatOd, TOLERANCE_DNI))
  const sp = sparovat(fioPohyby, docs, TOLERANCE_DNI)
  const cerstveOd = dniZpet(dnes, CERSTVE_DNI)
  const sCerstvym = (f: FioPohyb) => ({ ...f, cerstvy: f.datum >= cerstveOd })

  // Druhé kolo: pohyb FIO bez zaúčtovaného dokladu hledáme mezi nezaúčtovanými doklady
  // evidence banka (do deníku se nepropíšou, sync je nevidí) — čte se živě z ABRA.
  // Načítají se od začátku roku: jejich součet chybí v zůstatku 221 (dlaždice „po zaúčtování").
  let zbyleFio = sp.jenFio
  let nezauctovano: KontrolaReport['pohyby']['nezauctovano'] = []
  let nezauctovanoChyba: string | null = null
  let nezDoklady: BankDoklad[] = []
  const cfg = abraConfigFromEnv()
  if (!cfg) nezauctovanoChyba = 'ABRA není nastavená — nezaúčtované bankovní doklady nejde rozlišit.'
  else {
    try {
      const nez = (await fetchBankaNezauctovane(cfg, od, konec))
        .filter((b) => b.ucet?.startsWith('221'))
        .map(nezauctovanyDoklad)
      nezDoklady = nez
      const sp2 = sparovat(zbyleFio, nez, TOLERANCE_DNI)
      zbyleFio = sp2.jenFio
      nezauctovano = sp2.pary
        .map((p) => ({ fio: sCerstvym(p.fio), doklad: p.abra }))
        .sort((a, b) => b.fio.datum.localeCompare(a.fio.datum))
    } catch (e) {
      nezauctovanoChyba = `Nezaúčtované bankovní doklady z ABRA nejde načíst: ${(e as Error).message}`
    }
  }
  const jenFio = zbyleFio.map(sCerstvym).sort((a, b) => b.datum.localeCompare(a.datum))
  const jenAbra = sp.jenAbra.filter((d) => d.datum >= parovatOd).sort((a, b) => b.datum.localeCompare(a.datum))

  // Pokladna: zůstatek 211 a inventury.
  const pokladna = periods.map((p) => {
    const datum = lastDay(p) < konec ? lastDay(p) : konec
    return { period: p, datum, ...zustatekUctu(rows, '211', r, datum, pocatek('211')) }
  })
  const inventury = (inv.data ?? []).map((i) => {
    const abra = zustatekUctu(rows, '211', r, i.datum, pocatek('211')).zustatek
    return { id: i.id, datum: i.datum, castka: Number(i.castka), abra, rozdil: Math.round((Number(i.castka) - abra) * 100) / 100, poznamka: i.poznamka }
  })

  // Dotace KÚ: přijaté zálohy (ABRA) vs. nárok (Veřejné finance), kumulativně od ledna.
  const { poMesicich: prijato, poZakazkach } = prijataDotace(rows, dotUcet)
  let narok: Map<string, number> | null = null
  let narokPoPolozkach: { nazev: string; narok: number }[] = []
  let narokChyba: string | null = null
  try {
    const vf = await loadVfReport(sb, periods.map(parsePeriod))
    narok = vf.res.totalByPeriod
    narokPoPolozkach = vf.params.polozky
      .filter((p) => (vf.res.totalByPolozka.get(p.id) ?? 0) !== 0)
      .map((p) => ({ nazev: p.nazev, narok: vf.res.totalByPolozka.get(p.id) ?? 0 }))
    if (vf.res.warnings.length) narokChyba = `Nárok může být neúplný: ${vf.res.warnings[0]}`
  } catch (e) {
    narokChyba = `Nárok z Veřejných financí nejde spočítat: ${(e as Error).message}`
  }
  let kumP = 0
  let kumN = 0
  const dotaceMesice = periods.map((p) => {
    const pr = prijato.get(p) ?? 0
    const na = narok ? (narok.get(p) ?? 0) : null
    kumP += pr
    if (na !== null) kumN += na
    return {
      period: p, prijato: pr, narok: na,
      kumPrijato: Math.round(kumP * 100) / 100,
      kumNarok: narok ? Math.round(kumN * 100) / 100 : null,
      rozdil: narok ? Math.round((kumP - kumN) * 100) / 100 : null,
    }
  })

  const posledniBanka = [...banka].reverse().find((m) => m.rozdil !== null)
  // Rozdíl ABRA − FIO, jako by nezaúčtované bankovní doklady (do data posledního měsíce) už byly zaúčtované.
  const nezSuma = posledniBanka && !nezauctovanoChyba
    ? r2(nezDoklady.filter((d) => d.datum <= posledniBanka.datum).reduce((a, d) => a + d.castka, 0))
    : null
  return {
    rok: r,
    dnes,
    abraData: rows.length > 0,
    fioOd,
    banka: { mesice: banka, pocatekZdroj: banka[banka.length - 1]?.zdroj ?? 'chybi', pocatekRucne: pocatek('221') },
    pohyby: { sparovano: sp.pary.length, jenFio, nezauctovano, nezauctovanoChyba, jenAbra },
    pokladna: {
      mesice: pokladna.map(({ period, datum, zustatek }) => ({ period, datum, zustatek })),
      pocatekZdroj: pokladna[pokladna.length - 1]?.pocatekZdroj ?? 'chybi',
      pocatekRucne: pocatek('211'),
      inventury,
    },
    dotace: {
      ucet: dotUcet, mesice: dotaceMesice, narokChyba, narokPoPolozkach,
      poZakazkach: [...poZakazkach.entries()].map(([zakazka, prijato]) => ({ zakazka, prijato })).sort((a, b) => b.prijato - a.prijato),
    },
    souhrn: {
      bankaRozdil: posledniBanka?.rozdil ?? null,
      nezauctovanoSuma: nezSuma,
      bankaRozdilPoZauctovani: posledniBanka?.rozdil != null && nezSuma !== null ? r2(posledniBanka.rozdil + nezSuma) : null,
      nesparovano: jenFio.filter((f) => !f.cerstvy).length + jenAbra.length,
      nezauctovano: nezauctovano.filter((n) => !n.fio.cerstvy).length,
      pokladnaZaporna: pokladna.filter((m) => m.zustatek < 0).map((m) => m.period),
      inventuraRozdil: inventury[0]?.rozdil ?? null,
    },
  }
}
