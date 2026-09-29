/**
 * lib/zpusob-psd.ts
 *
 * Způsob plnění povinné školní docházky — jediný výklad kódů v IS.
 *
 * Dvě úrovně dat:
 *   - student_education_mode.zpusob → kód MŠMT číselníku RASD (s historií
 *     valid_from/valid_to). Posílá se 1:1 do matriky (lib/msmt-xml.ts, ZPUSOB).
 *   - students.education_mode → hrubý snapshot pro UI a výkaz pro KÚ:
 *     'standardni' | 'jiny_zpusob' | 'domaci'.
 *
 * Číselník RASD ověřen 2026-09-29 (stistko.uiv.cz/katalog/cslnk.asp?idc=RASD).
 * Kód 30 = individuální vzdělávání § 41, NE § 38 (dřívější komentáře v init.sql
 * a matrika.sql to měly obráceně — opraveno migrací 134a). 40 (§ 42) MŠMT zrušilo
 * k 31. 8. 2019, 50 v RASD není; v DB jsou oba zakázány CHECKem.
 */

/** Kategorie pro výkaz pro KÚ a financování (normativ ZŠ § 36 / § 38 / § 41). */
export type ParagrafPsd = '36' | '38' | '41'

export type EducationMode = 'standardni' | 'jiny_zpusob' | 'domaci'

type RasdKod = { nazev: string; paragraf: ParagrafPsd }

/** Platné kódy RASD pro ZŠ. 12 a 15 jsou docházka do školy → § 36. */
export const RASD: Record<string, RasdKod> = {
  '11': { nazev: 'školní docházka ve škole zapsané ve školském rejstříku', paragraf: '36' },
  '12': { nazev: 'souběžné vzdělávání v ZŠ v rámci střídavé péče', paragraf: '36' },
  '15': { nazev: 'plnění PŠD podle § 50 odst. 3 ŠZ', paragraf: '36' },
  '21': { nazev: 'plnění PŠD v zahraniční škole mimo ČR (§ 38 odst. 1 písm. a) ŠZ)', paragraf: '38' },
  '22': { nazev: 'plnění PŠD ve škole při diplomatické misi ČR (§ 38 odst. 1 písm. b) ŠZ)', paragraf: '38' },
  '23': { nazev: 'plnění PŠD v zahraniční škole na území ČR (§ 38 odst. 1 písm. c) ŠZ)', paragraf: '38' },
  '24': { nazev: 'individuální výuka v zahraničí (§ 38 odst. 2 ŠZ)', paragraf: '38' },
  '25': { nazev: 'plnění PŠD v evropské škole (§ 38 odst. 1 písm. d) ŠZ)', paragraf: '38' },
  '30': { nazev: 'individuální vzdělávání (§ 41 ŠZ)', paragraf: '41' },
}

/** Snapshot students.education_mode ↔ kategorie §. */
export const EDUCATION_MODE: Record<EducationMode, { paragraf: ParagrafPsd; label: string }> = {
  standardni:  { paragraf: '36', label: 'Docházka do školy (§ 36)' },
  jiny_zpusob: { paragraf: '38', label: 'Plnění PŠD v zahraničí (§ 38)' },
  domaci:      { paragraf: '41', label: 'Individuální vzdělávání (§ 41)' },
}

/** Popisek kódu RASD (katalogový list, přehledy). Neznámý kód → „kód X". */
export function zpusobPsdLabel(kod: string): string {
  return RASD[kod]?.nazev ?? `kód ${kod}`
}

/** Kategorie § pro kód RASD; null = kód mimo platný číselník (40, 50…). */
export function paragrafZpusobu(kod: string): ParagrafPsd | null {
  return RASD[kod]?.paragraf ?? null
}

/** Popisek snapshotu students.education_mode (karta žáka). */
export function educationModeLabel(mode: string): string {
  return EDUCATION_MODE[mode as EducationMode]?.label ?? mode
}
