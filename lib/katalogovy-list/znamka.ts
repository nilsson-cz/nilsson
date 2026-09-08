// lib/katalogovy-list/znamka.ts
// Čistý převod slovního hodnocení (Mapa růstu) na klasifikační známku podle
// pravidel ŠVP Vilekuly, kap. 6.3. Bez závislosti na DB → testovatelné.
//
// Vstup = hodnocení všech OČEKÁVANÝCH OVU jednoho předmětu za jedno pololetí.
// Chybějící záznam (null) i stupeň `nezacali` = „nesplněno" (viz PRD R5):
// do modu se nepočítá, vstupuje jen do podmínek pro známky 4/5.
//
// Pořadí kategorií (od nejlepší): s_jistotou(1) > castecne(2) > s_dopomoci(3) > nezvlada(4).
// Remíza modu se řeší dle ŠVP; zbytkové případy (ŠVP nedefinuje) = nejbližší
// těžišti (vážený průměr pořadí), shoda → ve prospěch žáka.

export type Stupen =
  | 's_jistotou'
  | 'castecne'
  | 's_dopomoci'
  | 'nezvlada'
  | 'nezacali'

/** Kategorie vstupující do modu (bez „nesplněno"/nezacali). */
type ModusKategorie = 's_jistotou' | 'castecne' | 's_dopomoci' | 'nezvlada'

export type Znamka = 1 | 2 | 3 | 4 | 5
export type ZnamkaVysledek = Znamka | 'nehodnocen'

const PORADI: Record<ModusKategorie, number> = {
  s_jistotou: 1,
  castecne: 2,
  s_dopomoci: 3,
  nezvlada: 4,
}

const MODUS_KATEGORIE: ModusKategorie[] = [
  's_jistotou',
  'castecne',
  's_dopomoci',
  'nezvlada',
]

/** Kategorie podle pořadí (1–4). */
function kategoriePodlePoradi(poradi: number): ModusKategorie {
  return MODUS_KATEGORIE[poradi - 1]
}

/**
 * Vybere modus z kategorií se stejným nejvyšším počtem.
 * `pocty` = počty pro všechny 4 modové kategorie (nesplněno už vyloučeno).
 */
function urciModus(pocty: Record<ModusKategorie, number>): ModusKategorie {
  const max = Math.max(...MODUS_KATEGORIE.map((k) => pocty[k]))
  const remizni = MODUS_KATEGORIE.filter((k) => pocty[k] === max)

  // 1) Jednoznačný modus.
  if (remizni.length === 1) return remizni[0]

  // Těžiště = vážený průměr pořadí přes všechny hodnocené OVU (pro zbytkové případy).
  const celkem = MODUS_KATEGORIE.reduce((s, k) => s + pocty[k], 0)
  const teziste =
    MODUS_KATEGORIE.reduce((s, k) => s + PORADI[k] * pocty[k], 0) / celkem

  // Nejbližší těžišti, při shodné vzdálenosti nižší pořadí (ve prospěch žáka).
  const nejblizsiTezisti = (kandidati: ModusKategorie[]): ModusKategorie =>
    [...kandidati].sort((a, b) => {
      const da = Math.abs(PORADI[a] - teziste)
      const db = Math.abs(PORADI[b] - teziste)
      if (da !== db) return da - db
      return PORADI[a] - PORADI[b]
    })[0]

  // 2) Remíza dvou kategorií → pravidla ŠVP.
  if (remizni.length === 2) {
    const [nizsi, vyssi] = [...remizni].sort((a, b) => PORADI[a] - PORADI[b])
    const rozdil = PORADI[vyssi] - PORADI[nizsi]
    // sousední → lepší z nich (ve prospěch žáka)
    if (rozdil === 1) return nizsi
    // jedna kategorie mezi nimi → ta prostřední
    if (rozdil === 2) return kategoriePodlePoradi(PORADI[nizsi] + 1)
    // rozdíl 3 (dvě mezi: pořadí 2 a 3) → zbytkové pravidlo (těžiště)
    return nejblizsiTezisti([
      kategoriePodlePoradi(PORADI[nizsi] + 1),
      kategoriePodlePoradi(PORADI[nizsi] + 2),
    ])
  }

  // 3) Tři a více kategorií v remíze → zbytkové pravidlo (těžiště).
  return nejblizsiTezisti(remizni)
}

/**
 * Převede hodnocení očekávaných OVU jednoho předmětu/pololetí na známku.
 * @param hodnoceni pole přes VŠECHNY očekávané OVU; prvek = stupeň žáka nebo
 *                  null (bez záznamu). null i 'nezacali' = „nesplněno".
 */
export function prevodNaZnamku(hodnoceni: (Stupen | null)[]): ZnamkaVysledek {
  const pocty: Record<ModusKategorie, number> = {
    s_jistotou: 0,
    castecne: 0,
    s_dopomoci: 0,
    nezvlada: 0,
  }
  let maNesplneno = false

  for (const s of hodnoceni) {
    if (s === null || s === 'nezacali') {
      maNesplneno = true // mimo modus
    } else {
      pocty[s] += 1
    }
  }

  const hodnocenoCelkem =
    pocty.s_jistotou + pocty.castecne + pocty.s_dopomoci + pocty.nezvlada
  if (hodnocenoCelkem === 0) return 'nehodnocen' // O3: žádné uzavřené OVU

  const modus = urciModus(pocty)
  const maNezvlada = pocty.nezvlada > 0

  switch (modus) {
    case 's_jistotou':
      return 1
    case 'castecne':
      return 2
    case 's_dopomoci':
      // bez „nezvládá" → 3; jinak 4 (i s nesplněno, viz PRD O1)
      return maNezvlada ? 4 : 3
    case 'nezvlada':
      // s „nesplněno" → 5, jinak 4
      return maNesplneno ? 5 : 4
  }
}

/** Textový popis známky pro tisk. */
export function znamkaText(v: ZnamkaVysledek): string {
  switch (v) {
    case 1:
      return 'výborně'
    case 2:
      return 'chvalitebně'
    case 3:
      return 'dobře'
    case 4:
      return 'dostatečně'
    case 5:
      return 'nedostatečně'
    case 'nehodnocen':
      return 'nehodnocen(a)'
  }
}
