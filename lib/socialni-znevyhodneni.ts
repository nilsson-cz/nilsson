// lib/socialni-znevyhodneni.ts
// Kategorie sociálního znevýhodnění z pedagogické diagnostiky školy.
//
// Vstup: sedmimístný kód A–G (students.msmt_sz), každá pozice 0 / 1 / 2 / 4
// (žádné / mírné / významné / zásadní dopady); '0' = diagnostika nebyla.
// Oblasti: A domácí podpora, B vyučovací jazyk, C náročné chování
// z nezdravotních důvodů, D motivace a účast, E psychické potřeby, F fyzické
// a materiální potřeby, G spolupráce zákonného zástupce.
//
// Pravidla: Z. Němec, Identifikace dětí a žáků se sociálním znevýhodněním
// v MŠ, ZŠ a SŠ (NPI 2025), tabulka na str. 26. Index = součet bodů.
// Vyhodnocují se v tomto pořadí (pokrývají všechny kombinace, nepřekrývají se):
//   1. aspoň jedna 4                    → III zásadní potřeba podpory
//   2. aspoň dvě 2, nebo index > 5      → II  významná potřeba podpory
//   3. právě jedna 2 (index ≤ 5)        → I   ohrožení
//   4. jen 0 a 1, index 4–5             → I   ohrožení
//   5. jen 0 a 1, index < 4             → 0   bez sociálního znevýhodnění
// Výkaz Z 2-01: I → ř. 0512, II → 0513, III → 0514; I–III jdou do ř. 0511.
// Bez server-only závislostí.

export type KategorieSz = '0' | 'I' | 'II' | 'III'

export const KATEGORIE_SZ_NAZEV: Record<KategorieSz, string> = {
  '0': 'bez sociálního znevýhodnění',
  I: 'ohrožení sociálním znevýhodněním',
  II: 'sociální znevýhodnění s významnou potřebou podpory',
  III: 'sociální znevýhodnění se zásadní potřebou podpory',
}

/** Kategorie z kódu A–G; neplatný kód nebo '0' → '0'. */
export function kategorieSz(kod: string | null | undefined): KategorieSz {
  const v = (kod ?? '').trim()
  if (!/^[0124]{7}$/.test(v)) return '0'
  const body = v.split('').map(Number)
  const index = body.reduce((s, b) => s + b, 0)
  const dvojky = body.filter((b) => b === 2).length
  if (body.includes(4)) return 'III'
  if (dvojky >= 2 || index > 5) return 'II'
  if (dvojky === 1) return 'I'
  return index >= 4 ? 'I' : '0'
}
