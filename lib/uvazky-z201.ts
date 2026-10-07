// lib/uvazky-z201.ts
// Úvazky pedagogů ve školní družině k rozhodnému datu (staff_uvazky_k_datu,
// migrace 150) a jejich přepočet pro výkaz Z 2-01, oddíl XIV.
//
// Metodický pokyn Z 2-01 (2025):
//   - zahrnují se všichni, kdo činnost v ŠD vykonávají, bez ohledu na
//     pracovněprávní vztah; dlouhodobě nepřítomný se nevykazuje (vykáže se náhrada),
//   - interní (pracovní poměr): přepočet = úvazek vůči základnímu úvazku kategorie,
//   - externí (dohody): přepočet = hodiny všech externistů za říjen / pracovní
//     hodiny října (8 h × pracovní dny; např. říjen 2025 = 176 h),
//   - přepočtené počty s přesností na 1 desetinné místo,
//   - 1404a: asistent pedagoga jen poměrnou částí úvazku působící v ŠD.
// Bez server-only závislostí (používá i klient).

import { czechStateHolidays } from '@/lib/school-calendar'

export type PoziceSd = 'vychovatel_sd' | 'asistent_pedagoga_sd' | 'jiny_pedagog_sd'

export const POZICE_SD: { kod: PoziceSd; nazev: string }[] = [
  { kod: 'vychovatel_sd', nazev: 'Vychovatel/ka' },
  { kod: 'asistent_pedagoga_sd', nazev: 'Asistent/ka pedagoga v družině' },
  { kod: 'jiny_pedagog_sd', nazev: 'Jiný pedagog v družině' },
]

export interface UvazekSd {
  staff_id: string
  pozice: PoziceSd
  interni: boolean
  uvazek: number | null        // interní: podíl základního úvazku za práci v ŠD
  hodiny_rijen: number | null  // externí: odpracované hodiny v říjnu
  zena: boolean
  nepritomen: boolean
  poznamka: string | null
}

/** Kontrola jednoho řádku; vrací text chyby, nebo null. */
export function chybaUvazku(u: UvazekSd): string | null {
  if (!POZICE_SD.some((p) => p.kod === u.pozice)) return 'Neplatná pozice.'
  if (u.interni) {
    if (u.uvazek === null || !Number.isFinite(u.uvazek) || u.uvazek <= 0 || u.uvazek > 2) {
      return 'Úvazek zadejte jako podíl, např. 0,6 (větší než 0, nejvýš 2).'
    }
  } else if (u.hodiny_rijen === null || !Number.isFinite(u.hodiny_rijen) || u.hodiny_rijen < 0 || u.hodiny_rijen > 9999) {
    return 'U externího pracovníka zadejte hodiny odpracované v říjnu.'
  }
  return null
}

/** Pracovní hodiny října daného roku: pracovní dny (po–pá bez státních svátků) × 8. */
export function pracovniHodinyRijna(rok: number): number {
  const svatky = new Set(czechStateHolidays(rok).map((s) => s.datum))
  let dny = 0
  for (let d = 1; d <= 31; d++) {
    const iso = `${rok}-10-${String(d).padStart(2, '0')}`
    const den = new Date(`${iso}T12:00:00Z`).getUTCDay()
    if (den !== 0 && den !== 6 && !svatky.has(iso)) dny++
  }
  return dny * 8
}

export interface RadekXIV {
  fyzicke: number
  zeny: number
  prepocet: number   // zaokrouhleno na 1 desetinné místo
}

export type OddilXIV = Record<'1401' | '1402' | '1403' | '1404' | '1404a' | '1405' | '1406', RadekXIV>

const r1 = (x: number) => Math.round(x * 10) / 10

/**
 * Oddíl XIV z úvazků k RDAT. Fyzická osoba se v řádku interních / externích
 * počítá jednou. Součtové řádky 1401 a 1404 = interní + externí ve všech
 * sloupcích (kontrolní vazba sberdat), přepočet se zaokrouhluje po řádcích.
 * Přepočet externích = jejich hodiny za říjen / pracovní hodiny října.
 */
export function oddilXIV(uvazky: UvazekSd[], hodinyRijna: number): OddilXIV {
  const platne = uvazky.filter((u) => !u.nepritomen)
  const radek = (filtr: (u: UvazekSd) => boolean, interni: boolean): RadekXIV => {
    const vyber = platne.filter((u) => filtr(u) && u.interni === interni)
    const osoby = new Map<string, boolean>()
    for (const u of vyber) osoby.set(u.staff_id, u.zena)
    const prepocet = interni
      ? vyber.reduce((s, u) => s + (u.uvazek ?? 0), 0)
      : (hodinyRijna > 0 ? vyber.reduce((s, u) => s + (u.hodiny_rijen ?? 0), 0) / hodinyRijna : 0)
    return { fyzicke: osoby.size, zeny: [...osoby.values()].filter(Boolean).length, prepocet: r1(prepocet) }
  }
  const soucet = (a: RadekXIV, b: RadekXIV): RadekXIV =>
    ({ fyzicke: a.fyzicke + b.fyzicke, zeny: a.zeny + b.zeny, prepocet: r1(a.prepocet + b.prepocet) })

  const vych = (u: UvazekSd) => u.pozice === 'vychovatel_sd'
  const ost = (u: UvazekSd) => u.pozice !== 'vychovatel_sd'
  const ap = (u: UvazekSd) => u.pozice === 'asistent_pedagoga_sd'
  const r1402 = radek(vych, true)
  const r1403 = radek(vych, false)
  const r1405 = radek(ost, true)
  const r1406 = radek(ost, false)
  return {
    '1401': soucet(r1402, r1403),
    '1402': r1402,
    '1403': r1403,
    '1404': soucet(r1405, r1406),
    '1404a': soucet(radek(ap, true), radek(ap, false)),
    '1405': r1405,
    '1406': r1406,
  }
}
