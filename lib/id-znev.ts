// lib/id-znev.ts
// Rozklad identifikátoru znevýhodnění (ID_ZNEV) z doporučení ŠPZ.
//
// Tvar ABbCcDEFfGgHh (7–13 znaků; v IS vp_doporuceni.id_znev = prvních 7,
// id_znev_dalsi = FfGgHh):
//   A   souběžné postižení více vadami (0 / 1)
//   Bb  převažující zdravotní znevýhodnění (číselník RAZN)
//   Cc  další zdravotní znevýhodnění (RAZN)
//   D   vliv kulturního prostředí / jiných životních podmínek: 0, K, Z, V
//   E   nadání: 0 bez, 1 nadaný, 2 mimořádně nadaný (vždy zjištěno ŠPZ)
//   Ff Gg Hh  další zdravotní znevýhodnění (RAZN)
//
// RAZN (stistko.uiv.cz, platné od 1. 9. 2016): 00 bez; 0M/0T krátkodobé /
// dlouhodobé SVP mimo 1M–8T (zdravotní znevýhodnění mimo § 16 odst. 9);
// 1 mentální (M S T Y), 2 sluchové (M S T Y), 3 zrakové (M S T Y), 4 vady řeči
// (M S T), 5 tělesné (M S T), 6 poruchy chování (M S T), 7 poruchy učení
// (M S T), 8 PAS (M J T). Druh 1–8 = zdravotní postižení podle § 16 odst. 9.
// Bez server-only závislostí.

export interface IdZnev {
  /** A = 1 — souběžné postižení více vadami. */
  viceVad: boolean
  /** Kódy RAZN v pořadí Bb, Cc, Ff, Gg, Hh bez „00“. */
  kody: string[]
  /** D — 0 / K / Z / V. */
  kulturni: string
  /** E — 0 / 1 / 2. */
  nadani: string
}

const RE_ZAKLAD = /^[01][0-9][0-9A-Z][0-9][0-9A-Z][0KZV][012]$/

/** Rozloží ID_ZNEV (+ případné další znevýhodnění); neplatný tvar → null. */
export function rozlozIdZnev(idZnev: string | null | undefined, dalsi?: string | null): IdZnev | null {
  const zaklad = (idZnev ?? '').trim().toUpperCase()
  if (!RE_ZAKLAD.test(zaklad)) return null
  const zbytek = (dalsi ?? '').trim().toUpperCase()
  const kody = [zaklad.slice(1, 3), zaklad.slice(3, 5)]
  for (let i = 0; i + 1 < zbytek.length && i < 6; i += 2) kody.push(zbytek.slice(i, i + 2))
  return {
    viceVad: zaklad[0] === '1',
    kody: kody.filter((k) => /^[0-9][0-9A-Z]$/.test(k) && k !== '00'),
    kulturni: zaklad[5],
    nadani: zaklad[6],
  }
}

/** Kód RAZN je zdravotní postižení podle § 16 odst. 9 (druh 1–8). */
export function jeZdravotniPostizeni(kod: string): boolean {
  return /^[1-8][MSTYJ]$/.test(kod)
}

/** Kód RAZN je zdravotní znevýhodnění mimo § 16 odst. 9 (0M / 0T). */
export function jeJineZdravotniZnevyhodneni(kod: string): boolean {
  return kod === '0M' || kod === '0T'
}

/** Převažující zdravotní postižení § 16 odst. 9 (první takový kód), nebo null. */
export function prevazujiciPostizeni(z: IdZnev): string | null {
  return z.kody.find(jeZdravotniPostizeni) ?? null
}
