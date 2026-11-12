/**
 * lib/manazerske-ucetnictvi/kontrola.ts
 * Kontrola — odsouhlasení banky a pokladny (čisté funkce bez DB).
 *
 *  - zůstatek účtu 221 (banka) / 211 (pokladna) v ABRA k datu: počáteční stav
 *    + obraty roku (MD +, DAL −). Počáteční stav = otevření účtu proti 70x
 *    v deníku; když v deníku není, ruční zadání (mu_kontrola_pocatek).
 *  - párování pohybů FIO s bankovními doklady ABRA: přesná částka, ±N dní.
 */

export type KontrolaRadek = {
  flexi_id: number
  dat_ucto: string
  md_ucet: string | null
  dal_ucet: string | null
  castka: number
  doklad: string | null
  id_dokl: number | null
  evidence_path: string | null
  popis: string | null
  firma: string | null
  smazano: boolean
  zuctovano: boolean | null
}

export type UcetPrefix = '221' | '211'
export type PocatekZdroj = 'ucetnictvi' | 'rucne' | 'chybi'

const r2 = (n: number) => Math.round(n * 100) / 100
const plati = (r: KontrolaRadek) => !r.smazano && r.zuctovano !== false

/** Otevření účtu: řádek proti účtu 70x (počáteční účet rozvažný). */
export const jeOtevreni = (r: Pick<KontrolaRadek, 'md_ucet' | 'dal_ucet'>, prefix: string) =>
  (r.md_ucet?.startsWith(prefix) && r.dal_ucet?.startsWith('70')) || (r.dal_ucet?.startsWith(prefix) && r.md_ucet?.startsWith('70'))

/** Změna zůstatku účtu z řádku: MD +, DAL − (oba na stejném účtu = 0). */
export function pohybUctu(r: Pick<KontrolaRadek, 'md_ucet' | 'dal_ucet' | 'castka'>, prefix: string): number {
  let d = 0
  if (r.md_ucet?.startsWith(prefix)) d += Number(r.castka)
  if (r.dal_ucet?.startsWith(prefix)) d -= Number(r.castka)
  return d
}

/**
 * Zůstatek účtu ke konci dne `datum` (v rámci roku `rok`).
 * Počáteční stav: z deníku (otevření proti 70x), jinak ruční, jinak chybí (počítá se od 0).
 */
export function zustatekUctu(
  radky: KontrolaRadek[], prefix: UcetPrefix, rok: number, datum: string, rucniPocatek: number | null,
): { zustatek: number; pocatekZdroj: PocatekZdroj } {
  const od = `${rok}-01-01`
  const vRoce = radky.filter((r) => plati(r) && r.dat_ucto >= od && r.dat_ucto <= datum)
  const maOtevreni = radky.some((r) => plati(r) && r.dat_ucto.startsWith(String(rok)) && jeOtevreni(r, prefix))
  let s = vRoce.reduce((a, r) => a + pohybUctu(r, prefix), 0)
  let zdroj: PocatekZdroj = 'ucetnictvi'
  if (!maOtevreni) {
    if (rucniPocatek !== null) { s += rucniPocatek; zdroj = 'rucne' } else zdroj = 'chybi'
  }
  return { zustatek: r2(s), pocatekZdroj: zdroj }
}

export type BankDoklad = { key: string; datum: string; castka: number; doklad: string | null; popis: string | null; firma: string | null; flexiIds: number[] }

/** Bankovní doklady ABRA: řádky se stranou 221 seskupené podle dokladu (bez otevření účtu). */
export function bankovniDoklady(radky: KontrolaRadek[]): BankDoklad[] {
  const by = new Map<string, BankDoklad>()
  for (const r of radky) {
    if (!plati(r) || jeOtevreni(r, '221')) continue
    const d = pohybUctu(r, '221')
    if (d === 0) continue
    const key = r.id_dokl !== null ? `${r.evidence_path}|${r.id_dokl}` : `r${r.flexi_id}`
    const b = by.get(key) ?? { key, datum: r.dat_ucto, castka: 0, doklad: r.doklad, popis: r.popis, firma: r.firma, flexiIds: [] }
    b.castka = r2(b.castka + d)
    if (r.dat_ucto < b.datum) b.datum = r.dat_ucto
    b.flexiIds.push(r.flexi_id)
    by.set(key, b)
  }
  return [...by.values()].filter((b) => b.castka !== 0)
}

/** Nezaúčtovaný bankovní doklad (evidence banka) jako BankDoklad — klíč „banka|id" kvůli odkazu do Flexi. */
export function nezauctovanyDoklad(b: { id: number; kod: string | null; datum: string; castka: number; popis: string | null; firma: string | null }): BankDoklad {
  return { key: `banka|${b.id}`, datum: b.datum, castka: b.castka, doklad: b.kod, popis: b.popis, firma: b.firma, flexiIds: [] }
}

/**
 * Přiznaná dotace KÚ (zálohy + doplatky) po měsících a zakázkách z účtu `dotUcet` (346):
 * DAL 346 (předpis proti 378 nebo platba proti 221) +, MD 346 (vratka) −.
 * Zúčtování do výnosů (346 ↔ 6xx na konci roku) se nepočítá.
 */
export function prijataDotace(radky: (KontrolaRadek & { zakazka?: string | null })[], dotUcet: string) {
  const poMesicich = new Map<string, number>()
  const poZakazkach = new Map<string, number>()
  for (const r of radky) {
    if (!plati(r)) continue
    let d = 0
    if (r.dal_ucet?.startsWith(dotUcet) && !r.md_ucet?.startsWith('6')) d = Number(r.castka)
    else if (r.md_ucet?.startsWith(dotUcet) && !r.dal_ucet?.startsWith('6')) d = -Number(r.castka)
    if (!d) continue
    const p = r.dat_ucto.slice(0, 7)
    poMesicich.set(p, r2((poMesicich.get(p) ?? 0) + d))
    const z = r.zakazka ?? '(bez zakázky)'
    poZakazkach.set(z, r2((poZakazkach.get(z) ?? 0) + d))
  }
  return { poMesicich, poZakazkach }
}

export type FioPohyb = { id: string; datum: string; castka: number; protistrana: string | null; poznamka: string | null }

const dni = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000

/**
 * Spáruje pohyby FIO s bankovními doklady ABRA: přesná částka, datum ±`tolerance` dní.
 * Páry se přidělují od nejmenšího rozdílu dní (ne chronologicky po FIO) — jinak dřívější
 * pohyb se stejnou částkou „sebere" doklad, který přesně sedí na pozdější pohyb
 * (3 000 Kč 22. a 27. 5. 2026). Každá strana se páruje nejvýš jednou.
 */
export function sparovat(fio: FioPohyb[], abra: BankDoklad[], tolerance = 3) {
  const kandidati: { f: FioPohyb; a: BankDoklad; d: number }[] = []
  for (const f of fio) {
    for (const a of abra) {
      if (Math.abs(a.castka - f.castka) > 0.004) continue
      const d = dni(a.datum, f.datum)
      if (d <= tolerance) kandidati.push({ f, a, d })
    }
  }
  kandidati.sort((x, y) => x.d - y.d || x.f.datum.localeCompare(y.f.datum) || x.a.datum.localeCompare(y.a.datum))
  const volneFio = new Set(fio.map((f) => f.id))
  const volne = new Set(abra.map((a) => a.key))
  const pary: { fio: FioPohyb; abra: BankDoklad; rozdilDni: number }[] = []
  for (const k of kandidati) {
    if (!volneFio.has(k.f.id) || !volne.has(k.a.key)) continue
    volneFio.delete(k.f.id); volne.delete(k.a.key)
    pary.push({ fio: k.f, abra: k.a, rozdilDni: k.d })
  }
  return { pary, jenFio: fio.filter((f) => volneFio.has(f.id)), jenAbra: abra.filter((a) => volne.has(a.key)) }
}
