// lib/msmt-sber.ts
// Kontext sběru dat ze školní matriky MŠMT — jarní vs. podzimní.
//
// Metodika MŠMT (Informace a metodické poznámky k předávání údajů ze školních
// matrik, https://matrika.msmt.cz/matrikas/HELPY/POKYNY.PDF):
//   - JARNÍ sběr, rozhodné datum (RDAT) 31. 3.: věty s platností v intervalu
//     1. 9. minulého – 31. 3. aktuálního kalendářního roku (aktuální školní rok);
//     OML_H/NEOML_H za 1. pololetí AKTUÁLNÍHO školního roku.
//   - PODZIMNÍ sběr, RDAT 30. 9.: věty s platností alespoň jedním dnem v intervalu
//     1. 10. minulého – 30. 9. aktuálního roku (tj. i žáci, kteří mezitím odešli
//     nebo vyšli); OML_H/NEOML_H za 2. pololetí PŘEDCHOZÍHO školního roku;
//     navíc soubor „b" (podpůrná opatření 2.–5. stupně).
// V obou případech jde o hodiny ze školního roku (R-1)/R, kde R je rok RDAT.

export type Sber = 'jarni' | 'podzimni'

export interface SberKontext {
  sber: Sber
  /** Kalendářní rok rozhodného data. */
  rok: number
  /** Rozhodné datum (RDAT) — lokální poledne. */
  rdat: Date
  /** ISO tvar RDAT (YYYY-MM-DD). */
  rdatIso: string
  /** Školní rok, za který se vykazují zameškané hodiny: '(R-1)/R'. */
  omlSkolniRok: string
  /** Pololetí, za které se vykazují zameškané hodiny. */
  omlPololeti: 1 | 2
  /** Interval, do kterého musí platnost věty zasahovat (ISO, včetně). */
  obdobiOd: string
  obdobiDo: string
  /** Školní rok, ve kterém leží RDAT (jaro: (R-1)/R, podzim: R/(R+1)). */
  skolniRokRdat: string
  /** Předává se soubor „b" (jen podzim). */
  souborB: boolean
  /** Lidský popis, např. „podzimní sběr k 30. 9. 2026". */
  popis: string
  /** Orientační termín odevzdání (přesný stanoví KÚ). */
  termin: string
}

export function sberKontext(sber: Sber, rok: number): SberKontext {
  const skolniRokPred = `${rok - 1}/${rok}`
  if (sber === 'jarni') {
    return {
      sber, rok,
      rdat: new Date(rok, 2, 31, 12),
      rdatIso: `${rok}-03-31`,
      omlSkolniRok: skolniRokPred,
      omlPololeti: 1,
      obdobiOd: `${rok - 1}-09-01`,
      obdobiDo: `${rok}-03-31`,
      skolniRokRdat: skolniRokPred,
      souborB: false,
      popis: `jarní sběr k 31. 3. ${rok}`,
      termin: `do 15. 4. ${rok}`,
    }
  }
  return {
    sber, rok,
    rdat: new Date(rok, 8, 30, 12),
    rdatIso: `${rok}-09-30`,
    omlSkolniRok: skolniRokPred,
    omlPololeti: 2,
    obdobiOd: `${rok - 1}-10-01`,
    obdobiDo: `${rok}-09-30`,
    skolniRokRdat: `${rok}/${rok + 1}`,
    souborB: true,
    popis: `podzimní sběr k 30. 9. ${rok}`,
    termin: `v říjnu ${rok}`,
  }
}

/**
 * Výchozí sběr = nejbližší rozhodné datum (i nadcházející) — sběr se chystá
 * už před RDAT (v září podzimní, v březnu jarní). Např. 28. 9. 2026 → podzim
 * 2026; 1. 12. 2026 → podzim 2026; 1. 3. 2027 → jaro 2027.
 */
export function vychoziSber(dnes: Date = new Date()): { sber: Sber; rok: number } {
  const y = dnes.getFullYear()
  const kandidati = [
    sberKontext('podzimni', y - 1),
    sberKontext('jarni', y),
    sberKontext('podzimni', y),
    sberKontext('jarni', y + 1),
  ]
  const t = dnes.getTime()
  const nejblizsi = kandidati.reduce((best, k) =>
    Math.abs(k.rdat.getTime() - t) < Math.abs(best.rdat.getTime() - t) ? k : best,
  )
  return { sber: nejblizsi.sber, rok: nejblizsi.rok }
}

/** Parsování ?sber=podzimni-2026 / jarni-2027; neplatné → výchozí. */
export function parseSber(param: string | null | undefined, dnes: Date = new Date()): SberKontext {
  const m = /^(jarni|podzimni)-(\d{4})$/.exec(param ?? '')
  if (m) {
    const rok = Number(m[2])
    if (rok >= 2020 && rok <= 2100) return sberKontext(m[1] as Sber, rok)
  }
  const v = vychoziSber(dnes)
  return sberKontext(v.sber, v.rok)
}

export function sberParam(k: Pick<SberKontext, 'sber' | 'rok'>): string {
  return `${k.sber}-${k.rok}`
}

/** Platnost žáka [enrollment_date, withdrawal_date] zasahuje do období sběru. */
export function zakVObdobi(
  enrollmentDate: string | null,
  withdrawalDate: string | null,
  k: Pick<SberKontext, 'obdobiOd' | 'obdobiDo'>,
): boolean {
  if (enrollmentDate && enrollmentDate > k.obdobiDo) return false
  if (withdrawalDate && withdrawalDate < k.obdobiOd) return false
  return true
}
