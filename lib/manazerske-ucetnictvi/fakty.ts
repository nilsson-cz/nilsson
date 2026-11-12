/**
 * lib/manazerske-ucetnictvi/fakty.ts
 * Normalizace všech zdrojů na „fakty" a jejich agregace (TRD §5).
 * Čisté funkce — přehled, detail činnosti, graf i CSV jsou jen agregace jednoho seznamu.
 *
 * Akruální pohled (PRD D1): školné a platby rodičů podle předpisu (měsíc
 * `period`, jinak měsíc splatnosti), dotace podle nároku (Veřejné finance),
 * náklady podle DUZP v ABRA. Hotovostní pohled je cash-flow (F5).
 */

import {
  periodRadku, radekPlati, rozlozRadek, zaradit,
  type AbraRadekZarazeni, type MuAkceZakazka, type MuOverride, type MuPravidlo,
} from './zarazeni'

// ── Typy ────────────────────────────────────────────────────────────────────

/** Kam fakt patří. `ss` = platby akce, jejíž SS ještě není přiřazený k žádné akci. */
export type MuCil =
  | { kind: 'cinnost'; id: string }
  | { kind: 'akce'; id: string }
  | { kind: 'ss'; ss: string }
  | { kind: 'nezarazeno' }

export type MuTyp = 'prijem' | 'naklad'
export type MuZdroj = 'platby' | 'dar' | 'dotace' | 'abra' | 'preuctovani'

export type MuFakt = {
  period: string
  cil: MuCil
  kategorieId: string | null
  typ: MuTyp
  zdroj: MuZdroj
  castka: number
  /** Odkaz na zdrojový záznam (doklad ABRA, pohledávka, položka dotace). */
  ref?: { kind: 'abra' | 'obligation' | 'match' | 'vf' | 'akce'; id: string }
  /** Účet a dimenze ABRA (jen zdroj abra; pro CSV a rozpad). */
  ucet?: string
  zakazka?: string | null
  stredisko?: string | null
  doklad?: string | null
  /** Část řádku ABRA z ručního rozdělení (mu_abra_split, F3). */
  rozdeleno?: boolean
}

export const cilKey = (c: MuCil): string =>
  c.kind === 'cinnost' ? `c:${c.id}` : c.kind === 'akce' ? `a:${c.id}` : c.kind === 'ss' ? `s:${c.ss}` : 'n'

/** Id kategorií a činností podle kódu (seed migrace 154). */
export type MuKody = {
  kategorie: Map<string, string>   // kod → id
  cinnost: Map<string, string>     // kod → id
}

/** Kategorie podpůrných opatření (migrace 158): „Dotace na PO", „Mzdy — PO" a jejich podkategorie. */
export function poKategorie(kody: MuKody): Set<string> {
  return new Set([...kody.kategorie].filter(([kod]) => /^(dotace|mzdy)_po(_|$)/.test(kod)).map(([, id]) => id))
}

/**
 * Kategorie PO patří jen činnosti Podpůrná opatření — fakt jiné činnosti (typicky Školy)
 * s kategorií PO se přesune na PO. Akce a nezařazené zůstávají.
 */
export function presunPo<T extends { cil: MuCil; kategorieId: string | null }>(polozky: T[], kody: MuKody): T[] {
  const po = kody.cinnost.get('po')
  const kat = poKategorie(kody)
  if (!po || kat.size === 0) return polozky
  return polozky.map((p) => (p.cil.kind === 'cinnost' && p.cil.id !== po && p.kategorieId && kat.has(p.kategorieId)
    ? { ...p, cil: { kind: 'cinnost', id: po } }
    : p))
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Činnosti, jejichž příjmy jsou z Plateb (předpisy rodičům): výnos z ABRA na nich je tatáž
 * úplata podruhé, proto jen kontrolně (rozhodnutí 2026-10-23 po vzoru akcí s SS).
 * Hodnota = prefix účtu výnosu ('' = všechny výnosy činnosti):
 *   Družina  — 602400 „Úplata za školní družinu" vs. předpis druzina (SS 30+školní rok)
 *   Obědy    — 602300 Jídelna vs. předpisy lunch (režie obědů bere z ABRA jen náklady)
 *   Škola    — jen 602100 Školné (měsíční předpis OP) vs. předpisy tuition; ostatní výnosy Školy se počítají
 */
export const CINNOSTI_PRIJMY_Z_PLATEB: Record<string, string> = { druzina: '', obedy: '', skola: '6021' }

/** Id činnosti → prefix účtu výnosů, které jsou jen kontrolně. */
export function cinnostiZPlateb(kody: MuKody): Map<string, string> {
  return new Map(Object.entries(CINNOSTI_PRIJMY_Z_PLATEB).flatMap(([kod, prefix]) => {
    const id = kody.cinnost.get(kod)
    return id ? [[id, prefix] as const] : []
  }))
}

/**
 * Výnos z ABRA, který se nezapočítá (jen kontrolně): akce s SS a činnosti s příjmy z Plateb.
 * Dary (darové fondy) se počítají vždy.
 */
function vynosJenKontrolne(
  cil: MuCil, typ: MuTyp, ucet: string, dar: boolean | undefined, akceSeSs: Set<string>, zPlateb: Map<string, string>,
): boolean {
  if (typ !== 'prijem' || dar) return false
  if (cil.kind === 'akce') return akceSeSs.has(cil.id)
  if (cil.kind !== 'cinnost') return false
  const prefix = zPlateb.get(cil.id)
  return prefix !== undefined && ucet.startsWith(prefix)
}

// ── Generátory ──────────────────────────────────────────────────────────────

export type ObligationFakt = {
  id: string
  type: string
  amount: number
  period: string | null
  due_date: string
  ss_kod: string | null
}

/** Měsíc pohledávky: `period`, jinak měsíc splatnosti. */
export const periodPohledavky = (o: Pick<ObligationFakt, 'period' | 'due_date'>) => o.period ?? o.due_date.slice(0, 7)

/**
 * Předpisy z Plateb (akruálně = předepsaná částka).
 * tuition → Škola/školné, druzina → Družina, lunch → Obědy, event → akce podle SS.
 */
export function faktyPlatby(
  obligations: ObligationFakt[], months: Set<string>, akceBySs: Map<string, string>, kody: MuKody,
  vynechat: Set<string> = new Set(),
): MuFakt[] {
  const out: MuFakt[] = []
  const cin = (kod: string): MuCil => {
    const id = kody.cinnost.get(kod)
    return id ? { kind: 'cinnost', id } : { kind: 'nezarazeno' }
  }
  for (const o of obligations) {
    const period = periodPohledavky(o)
    if (!months.has(period) || !(Number(o.amount) > 0) || vynechat.has(o.id)) continue
    let cil: MuCil
    let kat: string
    switch (o.type) {
      case 'tuition': cil = cin('skola'); kat = 'skolne'; break
      case 'druzina': cil = cin('druzina'); kat = 'platby_druzina'; break
      case 'lunch': cil = cin('obedy'); kat = 'platby_obedy'; break
      default: {
        const akceId = o.ss_kod ? akceBySs.get(o.ss_kod) : undefined
        cil = akceId ? { kind: 'akce', id: akceId } : o.ss_kod ? { kind: 'ss', ss: o.ss_kod } : cin('skola')
        kat = 'platby_akce'
      }
    }
    out.push({
      period, cil, kategorieId: kody.kategorie.get(kat) ?? null, typ: 'prijem', zdroj: 'platby',
      castka: Number(o.amount), ref: { kind: 'obligation', id: o.id },
    })
  }
  return out
}

export type DarFakt = { matchId: string; donation: number; transactionDate: string; ssKod: string | null }

/** Dary z přeplatků (payment_matches.donation_amount) — k akci podle SS pohledávky. */
export function faktyDary(dary: DarFakt[], months: Set<string>, akceBySs: Map<string, string>, kody: MuKody): MuFakt[] {
  const out: MuFakt[] = []
  const skola = kody.cinnost.get('skola')
  for (const d of dary) {
    const period = d.transactionDate.slice(0, 7)
    if (!months.has(period) || !(d.donation > 0)) continue
    const akceId = d.ssKod ? akceBySs.get(d.ssKod) : undefined
    const cil: MuCil = akceId ? { kind: 'akce', id: akceId }
      : d.ssKod ? { kind: 'ss', ss: d.ssKod }
      : skola ? { kind: 'cinnost', id: skola } : { kind: 'nezarazeno' }
    out.push({
      period, cil, kategorieId: kody.kategorie.get('dary') ?? null, typ: 'prijem', zdroj: 'dar',
      castka: d.donation, ref: { kind: 'match', id: d.matchId },
    })
  }
  return out
}

/**
 * Doplatek režie obědů (F2): příjem Obědů v měsíci, kdy byly obědy odebrány —
 * jen za potvrzené měsíce. Pohledávky pololetní dávky se z faktyPlatby vynechávají,
 * aby se doplatek nezapočetl dvakrát.
 */
export function faktyRezieDoplatek(rows: { period: string; doplatek: number }[], months: Set<string>, kody: MuKody): MuFakt[] {
  const obedy = kody.cinnost.get('obedy')
  if (!obedy) return []
  return rows
    .filter((r) => months.has(r.period) && r.doplatek > 0)
    .map((r) => ({
      period: r.period, cil: { kind: 'cinnost', id: obedy }, kategorieId: kody.kategorie.get('rezie_doplatek') ?? null,
      typ: 'prijem', zdroj: 'platby', castka: Math.round(r.doplatek * 100) / 100,
    }))
}

export type NarokBunka = { period: string; polozkaId: string; narok: number | null }

/**
 * Dotace = nárok z Veřejných financí (akruálně), položka → činnost (+ kategorie) podle mapování.
 * Bez kategorie v mapování obecná kategorie „Dotace" (migrace 158 přidala podkategorie PO).
 */
export function faktyDotace(
  cells: NarokBunka[], polozkaCinnost: Map<string, string>, kody: MuKody,
  polozkaKategorie: Map<string, string> = new Map(),
): MuFakt[] {
  const out: MuFakt[] = []
  const skola = kody.cinnost.get('skola')
  for (const c of cells) {
    if (c.narok === null || c.narok === 0) continue
    const cinnostId = polozkaCinnost.get(c.polozkaId) ?? skola
    out.push({
      period: c.period,
      cil: cinnostId ? { kind: 'cinnost', id: cinnostId } : { kind: 'nezarazeno' },
      kategorieId: polozkaKategorie.get(c.polozkaId) ?? kody.kategorie.get('dotace') ?? null,
      typ: 'prijem', zdroj: 'dotace', castka: c.narok,
      ref: { kind: 'vf', id: `${c.period}|${c.polozkaId}` },
    })
  }
  return out
}

export type AbraRadekFakt = AbraRadekZarazeni & { doklad: string | null }

export type AbraStat = {
  vynechanoNezauctovano: number   // řádky zuctovano=false
  vylouceno: number               // položky vyloučené pravidlem/override
  konflikty: number               // položky s remízou pravidel
  splitPrekroceno: number         // rozdělení převyšuje částku řádku (doklad se v ABRA změnil)
  vynosyKontrolni: number         // nezařazené výnosy (třída 6) — jen kontrolně, do přehledu se nepočítají (D2)
}

/** Část řádku ABRA přeřazená jinam (migrace 160). Částka kladná, znaménko přebírá z řádku. */
export type MuSplit = {
  id: string
  flexi_id: number
  ucet: string
  cil_cinnost_id: string | null
  cil_akce_id: string | null
  kategorie_id: string
  castka: number
  poznamka: string | null
}

/** Náklady a výnosy z ABRA po zařazení. */
export function faktyAbra(
  radky: AbraRadekFakt[],
  months: Set<string>,
  pravidla: MuPravidlo[],
  overrides: Map<number, MuOverride>,
  akce: MuAkceZakazka[],
  kody: MuKody,
  splits: Map<number, MuSplit[]> = new Map(),
  darFondy: string[] = [],
  akceSeSs: Set<string> = new Set(),
  zPlateb: Map<string, string> = new Map(),
): { fakty: MuFakt[]; stat: AbraStat; kontrolni: MuFakt[] } {
  const fakty: MuFakt[] = []
  // Výnos z ABRA u akce s SS nebo činnosti s příjmy z Plateb = tytéž peníze jako předpisy → jen kontrolně.
  const kontrolni: MuFakt[] = []
  const pridat = (f: MuFakt, dar: boolean | undefined) => {
    if (vynosJenKontrolne(f.cil, f.typ, f.ucet ?? '', dar, akceSeSs, zPlateb)) kontrolni.push(f)
    else fakty.push(f)
  }
  const stat: AbraStat = { vynechanoNezauctovano: 0, vylouceno: 0, konflikty: 0, splitPrekroceno: 0, vynosyKontrolni: 0 }
  const fallback = { naklad: kody.kategorie.get('naklady_ostatni') ?? null, prijem: kody.kategorie.get('prijmy_ostatni') ?? null }
  const fallbackDar = { naklad: fallback.naklad, prijem: kody.kategorie.get('dary') ?? fallback.prijem }
  const skola = kody.cinnost.get('skola') ?? null
  for (const r of radky) {
    if (r.smazano) continue
    const ov = overrides.get(Number(r.flexi_id)) ?? null
    const period = periodRadku(r, ov)
    if (!months.has(period)) continue
    if (!radekPlati(r)) { stat.vynechanoNezauctovano++; continue }
    const casti = splits.get(Number(r.flexi_id)) ?? []
    for (const pol of rozlozRadek(r, darFondy)) {
      // Ruční rozdělení: části jdou na svůj cíl, zbytek se zařadí podle pravidel.
      const mojeCasti = casti.filter((s) => s.ucet === pol.ucet)
      const znamenko = pol.castka < 0 ? -1 : 1
      let rozdelenoCelkem = 0
      for (const s of mojeCasti) {
        rozdelenoCelkem += s.castka
        pridat({
          period,
          cil: s.cil_akce_id ? { kind: 'akce', id: s.cil_akce_id } : { kind: 'cinnost', id: s.cil_cinnost_id as string },
          kategorieId: s.kategorie_id,
          typ: pol.typ, zdroj: 'abra', castka: r2(znamenko * s.castka),
          ref: { kind: 'abra', id: String(r.flexi_id) },
          ucet: pol.ucet, zakazka: r.zakazka, stredisko: r.stredisko, doklad: r.doklad, rozdeleno: true,
        }, pol.dar)
      }
      if (rozdelenoCelkem > Math.abs(pol.castka) + 0.005) stat.splitPrekroceno++
      const zbytek = mojeCasti.length ? r2(znamenko * Math.max(0, Math.abs(pol.castka) - rozdelenoCelkem)) : pol.castka
      if (mojeCasti.length && Math.abs(zbytek) < 0.005) continue
      const z = zaradit(r, pol, pravidla, ov, akce, pol.dar ? fallbackDar : fallback)
      if (z.vyloucit) { stat.vylouceno++; continue }
      if (z.konflikt) stat.konflikty++
      if (z.zdroj === 'nezarazeno' && pol.typ === 'prijem') {
        if (!pol.dar) { stat.vynosyKontrolni++; continue }       // výnos z ABRA jen kontrolně (D2)
        z.cinnostId = skola                                     // nezařazený dar → Škola / Dary (neúčelový)
        z.kategorieId = fallbackDar.prijem
      }
      const cil: MuCil = z.akceId ? { kind: 'akce', id: z.akceId }
        : z.cinnostId ? { kind: 'cinnost', id: z.cinnostId }
        : { kind: 'nezarazeno' }
      pridat({
        period, cil, kategorieId: cil.kind === 'nezarazeno' ? null : z.kategorieId,
        typ: pol.typ, zdroj: 'abra', castka: r2(zbytek),
        ref: { kind: 'abra', id: String(r.flexi_id) },
        ucet: pol.ucet, zakazka: r.zakazka, stredisko: r.stredisko, doklad: r.doklad,
      }, pol.dar)
    }
  }
  return { fakty, stat, kontrolni }
}

export type AbraPolozkaVypis = {
  flexi_id: number
  period: string
  dat_ucto: string
  ucet: string
  typ: MuTyp
  castka: number                 // celá částka strany řádku (před rozdělením)
  zakazka: string | null
  stredisko: string | null
  doklad: string | null
  zdroj: 'override' | 'pravidlo' | 'akce' | 'nezarazeno'
  cil: MuCil
  kategorieId: string | null
  ignorovano: boolean            // vyloučeno ručně (override) nebo pravidlem
  ignorovanoRucne: boolean
  nezauctovano: boolean
  rozdeleno: number              // součet ručně oddělených částí
  kontrolni: boolean             // nezařazený výnos nebo výnos s příjmy z Plateb — jen kontrolně, nepočítá se
  dar: boolean                   // přírůstek darového fondu
}

/**
 * Výpis všech položek ABRA za období včetně ignorovaných a nezaúčtovaných (stránka Doklady).
 * Na rozdíl od faktyAbra nic nevynechává — jen ukazuje, kam a proč položka patří.
 */
export function polozkyAbraVypis(
  radky: AbraRadekFakt[],
  months: Set<string>,
  pravidla: MuPravidlo[],
  overrides: Map<number, MuOverride>,
  akce: MuAkceZakazka[],
  kody: MuKody,
  splits: Map<number, MuSplit[]> = new Map(),
  darFondy: string[] = [],
  akceSeSs: Set<string> = new Set(),
  zPlateb: Map<string, string> = new Map(),
): AbraPolozkaVypis[] {
  const out: AbraPolozkaVypis[] = []
  const fallback = { naklad: kody.kategorie.get('naklady_ostatni') ?? null, prijem: kody.kategorie.get('prijmy_ostatni') ?? null }
  const fallbackDar = { naklad: fallback.naklad, prijem: kody.kategorie.get('dary') ?? fallback.prijem }
  const skola = kody.cinnost.get('skola') ?? null
  for (const r of radky) {
    if (r.smazano) continue
    const ov = overrides.get(Number(r.flexi_id)) ?? null
    const period = periodRadku(r, ov)
    if (!months.has(period)) continue
    for (const pol of rozlozRadek(r, darFondy)) {
      const z = zaradit(r, pol, pravidla, ov, akce, pol.dar ? fallbackDar : fallback)
      const nezarazenyPrijem = z.zdroj === 'nezarazeno' && pol.typ === 'prijem' && !z.vyloucit
      if (nezarazenyPrijem && pol.dar) { z.cinnostId = skola; z.kategorieId = fallbackDar.prijem }
      const cil: MuCil = z.vyloucit ? { kind: 'nezarazeno' }
        : z.akceId ? { kind: 'akce', id: z.akceId } : z.cinnostId ? { kind: 'cinnost', id: z.cinnostId } : { kind: 'nezarazeno' }
      out.push({
        flexi_id: Number(r.flexi_id), period, dat_ucto: r.dat_ucto, ucet: pol.ucet, typ: pol.typ, castka: r2(pol.castka),
        zakazka: r.zakazka, stredisko: r.stredisko, doklad: r.doklad,
        zdroj: z.zdroj, cil, kategorieId: z.vyloucit ? null : z.kategorieId,
        ignorovano: z.vyloucit, ignorovanoRucne: z.vyloucit && z.zdroj === 'override',
        nezauctovano: !radekPlati(r),
        rozdeleno: r2((splits.get(Number(r.flexi_id)) ?? []).filter((s) => s.ucet === pol.ucet).reduce((a, s) => a + s.castka, 0)),
        // Nezařazený výnos (D2) nebo výnos akce s SS / činnosti s příjmy z Plateb.
        kontrolni: (nezarazenyPrijem && !pol.dar) || vynosJenKontrolne(cil, pol.typ, pol.ucet, pol.dar, akceSeSs, zPlateb),
        dar: !!pol.dar,
      })
    }
  }
  return presunPo(out, kody)
}

export type AkcePersonalni = {
  id: string
  datum_od: string
  personalni_naklady: number | null
  personalni_period: string | null
}

/**
 * Personální náklady akcí (PRD D8/D9): ruční částka jako náklad akce a stejná
 * částka se odečte z Mezd Školy ve stejném měsíci — mzdy už jsou v ABRA u Školy,
 * celková bilance se tak nezmění (vnitřní přeúčtování).
 */
export function faktyPreuctovani(akce: AkcePersonalni[], months: Set<string>, kody: MuKody): MuFakt[] {
  const out: MuFakt[] = []
  const skola = kody.cinnost.get('skola')
  const katAkce = kody.kategorie.get('personalni_akce') ?? null
  const katMzdy = kody.kategorie.get('mzdy') ?? null
  for (const a of akce) {
    const castka = Number(a.personalni_naklady ?? 0)
    if (!(castka > 0)) continue
    const period = a.personalni_period ?? a.datum_od.slice(0, 7)
    if (!months.has(period)) continue
    out.push({ period, cil: { kind: 'akce', id: a.id }, kategorieId: katAkce, typ: 'naklad', zdroj: 'preuctovani', castka, ref: { kind: 'akce', id: a.id } })
    if (skola) out.push({ period, cil: { kind: 'cinnost', id: skola }, kategorieId: katMzdy, typ: 'naklad', zdroj: 'preuctovani', castka: -castka, ref: { kind: 'akce', id: a.id } })
  }
  return out
}

// ── Agregace ────────────────────────────────────────────────────────────────

export type Bilance = { prijmy: number; naklady: number; vysledek: number }

export const prazdnaBilance = (): Bilance => ({ prijmy: 0, naklady: 0, vysledek: 0 })

function pricti(b: Bilance, f: MuFakt) {
  if (f.typ === 'prijem') b.prijmy += f.castka
  else b.naklady += f.castka
  b.vysledek = b.prijmy - b.naklady
}

/** Součet faktů podle libovolného klíče. */
export function bilanceBy(fakty: MuFakt[], key: (f: MuFakt) => string): Map<string, Bilance> {
  const out = new Map<string, Bilance>()
  for (const f of fakty) {
    const k = key(f)
    const b = out.get(k) ?? prazdnaBilance()
    pricti(b, f)
    out.set(k, b)
  }
  for (const b of out.values()) {
    b.prijmy = r2(b.prijmy); b.naklady = r2(b.naklady); b.vysledek = r2(b.vysledek)
  }
  return out
}

export function celkem(fakty: MuFakt[]): Bilance {
  return bilanceBy(fakty, () => '*').get('*') ?? prazdnaBilance()
}
