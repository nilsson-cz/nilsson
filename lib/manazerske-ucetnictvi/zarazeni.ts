/**
 * lib/manazerske-ucetnictvi/zarazeni.ts
 * Zařazení řádků účetního deníku ABRA na činnost/akci a kategorii (TRD §4).
 * Čisté funkce — bez DB, testovatelné skriptem (scripts/mu-selftest.ts).
 *
 * Řádek deníku má (na reálných datech Flexi většinou) obě strany zápisu
 * (MD i DAL). Do manažerského pohledu vstupují jen strany na účtech tříd 5 a 6:
 *   MD 5xx → náklad +,  DAL 5xx → náklad − (storno, dobropis)
 *   DAL 6xx → výnos +,  MD 6xx → výnos −
 * Jeden řádek tak dá 0–2 „položky".
 */

export type AbraRadekZarazeni = {
  flexi_id: number
  dat_ucto: string
  duzp: string | null
  md_ucet: string | null
  dal_ucet: string | null
  castka: number
  zakazka: string | null
  stredisko: string | null
  cinnost_abra: string | null
  smazano: boolean
  zuctovano: boolean | null
}

export type MuPravidlo = {
  id: string
  ucet_prefix: string
  zakazka: string | null
  stredisko: string | null
  cinnost_abra: string | null
  cil_cinnost_id: string | null
  cil_akce_id: string | null
  kategorie_id: string | null
  vyloucit: boolean
  aktivni: boolean
}

export type MuOverride = {
  flexi_id: number
  cil_cinnost_id: string | null
  cil_akce_id: string | null
  kategorie_id: string | null
  vyloucit: boolean
  period: string | null
  poznamka: string
}

export type MuAkceZakazka = { id: string; abra_zakazka: string | null }

export type AbraPolozka = {
  ucet: string
  strana: 'MD' | 'D'
  typ: 'naklad' | 'prijem'
  castka: number   // kladné = zvyšuje náklad/výnos, záporné = snižuje
  dar?: boolean    // přírůstek darového fondu (třída 9, migrace 162)
}

export type Zarazeni = {
  zdroj: 'override' | 'pravidlo' | 'akce' | 'nezarazeno'
  cinnostId: string | null
  akceId: string | null
  kategorieId: string | null
  vyloucit: boolean
  pravidloId: string | null
  konflikt: boolean          // remíza dvou pravidel se stejným skóre
}

/** Řádek se počítá: nesmazaný a zaúčtovaný (zuctovano=false = rozpracovaný doklad, TRD O1). */
export function radekPlati(r: Pick<AbraRadekZarazeni, 'smazano' | 'zuctovano'>): boolean {
  return !r.smazano && r.zuctovano !== false
}

/** Měsíc, kam řádek patří: override → DUZP → datum zaúčtování. */
export function periodRadku(r: Pick<AbraRadekZarazeni, 'duzp' | 'dat_ucto'>, override?: Pick<MuOverride, 'period'> | null): string {
  if (override?.period) return override.period
  return (r.duzp ?? r.dat_ucto).slice(0, 7)
}

/**
 * Strany řádku na účtech tříd 5/6 a na darových účtech (`darFondy`, např. fond 911400 nebo
 * výnos darů 682100): přírůstek (DAL) je příjem — dar —, úbytek (MD) příjem snižuje.
 * Darový účet třídy 6 je jen dar, ne zároveň obyčejný výnos (jinak by se počítal dvakrát).
 */
export function rozlozRadek(r: Pick<AbraRadekZarazeni, 'md_ucet' | 'dal_ucet' | 'castka'>, darFondy: string[] = []): AbraPolozka[] {
  const out: AbraPolozka[] = []
  const c = Number(r.castka)
  const jeDar = (u: string | null) => !!u && darFondy.some((f) => u.startsWith(f))
  if (jeDar(r.md_ucet)) out.push({ ucet: r.md_ucet as string, strana: 'MD', typ: 'prijem', castka: -c, dar: true })
  if (jeDar(r.dal_ucet)) out.push({ ucet: r.dal_ucet as string, strana: 'D', typ: 'prijem', castka: c, dar: true })
  if (r.md_ucet?.startsWith('5')) out.push({ ucet: r.md_ucet, strana: 'MD', typ: 'naklad', castka: c })
  if (r.md_ucet?.startsWith('6') && !jeDar(r.md_ucet)) out.push({ ucet: r.md_ucet, strana: 'MD', typ: 'prijem', castka: -c })
  if (r.dal_ucet?.startsWith('5')) out.push({ ucet: r.dal_ucet, strana: 'D', typ: 'naklad', castka: -c })
  if (r.dal_ucet?.startsWith('6') && !jeDar(r.dal_ucet)) out.push({ ucet: r.dal_ucet, strana: 'D', typ: 'prijem', castka: c })
  return out.filter((p) => p.castka !== 0)
}

/**
 * Shoda zakázky pravidla: přesná, nebo se zástupným znakem na konci („33 155 ASISTENT*" = začíná
 * „33 155 ASISTENT") — zakázky jsou ve Flexi po školních letech (… 9/25-8/26).
 */
export function zakazkaSedi(vzor: string, zakazka: string | null): boolean {
  if (!vzor.endsWith('*')) return vzor === zakazka
  return zakazka !== null && zakazka.startsWith(vzor.slice(0, -1))
}

/** Skóre shody pravidla (vyšší = specifičtější; přesná zakázka má přednost před zástupným znakem); null = nesedí. */
export function skorePravidla(p: MuPravidlo, ucet: string, r: Pick<AbraRadekZarazeni, 'zakazka' | 'stredisko' | 'cinnost_abra'>): number | null {
  if (!p.aktivni || !ucet.startsWith(p.ucet_prefix)) return null
  if (p.zakazka !== null && !zakazkaSedi(p.zakazka, r.zakazka)) return null
  if (p.stredisko !== null && p.stredisko !== r.stredisko) return null
  if (p.cinnost_abra !== null && p.cinnost_abra !== r.cinnost_abra) return null
  const zak = p.zakazka === null ? 0 : p.zakazka.endsWith('*') ? 9 : 10
  return p.ucet_prefix.length + zak + (p.stredisko !== null ? 10 : 0) + (p.cinnost_abra !== null ? 10 : 0)
}

/** Nejspecifičtější pravidlo; remíza → nejnižší id + příznak konfliktu. */
export function vyberPravidlo(
  pravidla: MuPravidlo[], ucet: string, r: Pick<AbraRadekZarazeni, 'zakazka' | 'stredisko' | 'cinnost_abra'>,
  filtr: (p: MuPravidlo) => boolean = () => true,
): { pravidlo: MuPravidlo; konflikt: boolean } | null {
  let best: MuPravidlo | null = null
  let bestSkore = -1
  let konflikt = false
  for (const p of pravidla) {
    if (!filtr(p)) continue
    const s = skorePravidla(p, ucet, r)
    if (s === null) continue
    if (s > bestSkore || (s === bestSkore && best !== null && p.id < best.id)) {
      konflikt = s === bestSkore
      best = p
      bestSkore = s
    } else if (s === bestSkore) {
      konflikt = true
    }
  }
  return best ? { pravidlo: best, konflikt } : null
}

/**
 * Zařadí jednu položku řádku.
 * Priorita: override řádku → pravidlo se zadanou zakázkou/střediskem/činností →
 * implicitní pravidlo akce (mu_akce.abra_zakazka = zakázka řádku) → ostatní pravidla → Nezařazeno.
 * Má-li řádek zakázku akce, přebije ji jen pravidlo se zakázkou nebo vylučující pravidlo — středisko
 * je ve škole skoro na všem („C"), pravidlo jen se střediskem by jinak bralo grantům jejich doklady
 * (dar NF Zeměkvět 682100 skončil v Obědech, 2026-10-29).
 * U akce se kategorie bere z nejspecifičtějšího pravidla bez zakázky (podle účtu), jinak `fallbackKategorie`.
 */
export function zaradit(
  r: AbraRadekZarazeni,
  pol: AbraPolozka,
  pravidla: MuPravidlo[],
  override: MuOverride | null,
  akce: MuAkceZakazka[],
  fallbackKategorie: { naklad: string | null; prijem: string | null },
): Zarazeni {
  if (override) {
    return {
      zdroj: 'override',
      cinnostId: override.cil_cinnost_id,
      akceId: override.cil_akce_id,
      kategorieId: override.kategorie_id,
      vyloucit: override.vyloucit,
      pravidloId: null,
      konflikt: false,
    }
  }

  const fromPravidlo = (v: { pravidlo: MuPravidlo; konflikt: boolean }): Zarazeni => ({
    zdroj: 'pravidlo',
    cinnostId: v.pravidlo.cil_cinnost_id,
    akceId: v.pravidlo.cil_akce_id,
    kategorieId: v.pravidlo.kategorie_id,
    vyloucit: v.pravidlo.vyloucit,
    pravidloId: v.pravidlo.id,
    konflikt: v.konflikt,
  })

  const best = vyberPravidlo(pravidla, pol.ucet, r)
  const a = r.zakazka ? akce.find((x) => x.abra_zakazka === r.zakazka) : undefined
  const specificke = best && (a
    ? best.pravidlo.zakazka !== null || best.pravidlo.vyloucit
    : best.pravidlo.zakazka !== null || best.pravidlo.stredisko !== null || best.pravidlo.cinnost_abra !== null)
  if (best && specificke) return fromPravidlo(best)

  if (a) {
    const kat = vyberPravidlo(pravidla, pol.ucet, r, (p) => p.zakazka === null && !p.vyloucit)
    return {
      zdroj: 'akce',
      cinnostId: null,
      akceId: a.id,
      kategorieId: kat?.pravidlo.kategorie_id ?? fallbackKategorie[pol.typ],
      vyloucit: false,
      pravidloId: kat?.pravidlo.id ?? null,
      konflikt: false,
    }
  }

  if (best) return fromPravidlo(best)
  return { zdroj: 'nezarazeno', cinnostId: null, akceId: null, kategorieId: null, vyloucit: false, pravidloId: null, konflikt: false }
}
