// lib/druzina-provoz.ts
// Provozní doba oddělení školní družiny (druzina_oddeleni_provoz, migrace 150).
// Výkaz Z 2-01 ř. 0101b: týdenní rozsah provozu = součet hodin všech oddělení,
// s přesností na 1 desetinné místo. Bez server-only závislostí (používá i klient).

export interface ProvozDen {
  den: number   // 1 = pondělí … 5 = pátek
  od: string    // 'HH:MM'
  do: string    // 'HH:MM'
}

export const DNY_PROVOZU: { den: number; zkratka: string; nazev: string }[] = [
  { den: 1, zkratka: 'Po', nazev: 'pondělí' },
  { den: 2, zkratka: 'Út', nazev: 'úterý' },
  { den: 3, zkratka: 'St', nazev: 'středa' },
  { den: 4, zkratka: 'Čt', nazev: 'čtvrtek' },
  { den: 5, zkratka: 'Pá', nazev: 'pátek' },
]

const RE_CAS = /^([01]\d|2[0-3]):([0-5]\d)$/

/** 'HH:MM' nebo 'HH:MM:SS' (z Postgres TIME) → minuty od půlnoci; neplatné → null. */
export function casNaMinuty(cas: string): number | null {
  const m = RE_CAS.exec(cas.slice(0, 5))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Postgres TIME 'HH:MM:SS' → 'HH:MM'. */
export function kratkyCas(cas: string): string {
  return cas.slice(0, 5)
}

/** Kontrola jednoho dne; vrací text chyby, nebo null. */
export function chybaDne(d: ProvozDen): string | null {
  const od = casNaMinuty(d.od)
  const doMin = casNaMinuty(d.do)
  if (od === null || doMin === null) return 'Čas zadejte ve tvaru HH:MM.'
  if (doMin <= od) return 'Konec provozu musí být po začátku.'
  return null
}

/** Hodiny provozu za týden (neplatné dny se nepočítají). */
export function hodinyTydne(dny: ProvozDen[]): number {
  let minuty = 0
  for (const d of dny) {
    const od = casNaMinuty(d.od)
    const doMin = casNaMinuty(d.do)
    if (od !== null && doMin !== null && doMin > od) minuty += doMin - od
  }
  return minuty / 60
}

/** Zaokrouhlení na 1 desetinné místo (metodika Z 2-01). */
export function naDesetiny(h: number): number {
  return Math.round(h * 10) / 10
}

/** Stručný popis: „Po–Čt 11:40–17:00, Pá 11:40–16:00“. */
export function popisProvozu(dny: ProvozDen[]): string {
  const serazene = [...dny].sort((a, b) => a.den - b.den)
  const skupiny: { od: number; do: number; cas: string }[] = []
  for (const d of serazene) {
    const cas = `${kratkyCas(d.od)}–${kratkyCas(d.do)}`
    const posledni = skupiny[skupiny.length - 1]
    if (posledni && posledni.cas === cas && posledni.do === d.den - 1) posledni.do = d.den
    else skupiny.push({ od: d.den, do: d.den, cas })
  }
  const zkr = (den: number) => DNY_PROVOZU.find((x) => x.den === den)?.zkratka ?? String(den)
  return skupiny
    .map((s) => `${s.od === s.do ? zkr(s.od) : `${zkr(s.od)}–${zkr(s.do)}`} ${s.cas}`)
    .join(', ')
}
