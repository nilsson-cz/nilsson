// lib/rozvrh-nudge.ts
// Pure logika notifikací na nepotvrzené bloky (Fáze 2, §6) — bez Supabase.
// Low-noise: jeden souhrn na osobu, adresná zmínka, jen obsazené bloky po termínu.

const DNY_ZKR = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so']

/** 'YYYY-MM-DD' → 'čt 31. 7.' (krátký štítek do souhrnu). */
export function shortDenDatum(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return `${DNY_ZKR[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`
}

/** Vrátí lokální datum ('YYYY-MM-DD') v dané časové zóně. */
export function localDateInTZ(now: Date, timeZone: string): string {
  // en-CA dává rovnou 'YYYY-MM-DD'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Přičte k datu 'YYYY-MM-DD' n dní (může být záporné) → 'YYYY-MM-DD'. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Je datum pracovní den (Po–Pá) a není mezi dny bez výuky? */
export function isWorkingDay(dateStr: string, holidays: Set<string>): boolean {
  const dow = new Date(`${dateStr}T12:00:00`).getDay() // 0=Ne … 6=So
  return dow >= 1 && dow <= 5 && !holidays.has(dateStr)
}

export type NudgeBlok = { datum: string; nazev: string }
export type NudgeOsoba = {
  staffName: string
  discordId: string | null
  bloky: NudgeBlok[]
}

/**
 * Sestaví jednu adresnou zprávu do kanálu — sekce na osobu.
 * Vrací null, když není koho pingnout (žádná zpráva se neposílá).
 */
export function buildNudgeMessage(lidi: NudgeOsoba[]): string | null {
  const relevantni = lidi.filter((l) => l.bloky.length > 0)
  if (relevantni.length === 0) return null

  const sekce = relevantni.map((l) => {
    const kdo = l.discordId ? `<@${l.discordId}>` : `**${l.staffName}**`
    const bloky = l.bloky
      .slice()
      .sort((a, b) => a.datum.localeCompare(b.datum) || a.nazev.localeCompare(b.nazev))
      .map((b) => `${shortDenDatum(b.datum)} ${b.nazev}`)
      .join(', ')
    return `${kdo} — nepotvrzené: ${bloky}`
  })

  return [
    '📓 **Připomínka zápisu do třídnice**',
    'Máte bloky bez potvrzení. Otevři *Můj rozvrh* a zapiš, co se dělo.',
    '',
    ...sekce,
  ].join('\n')
}

/** Discord ID pro adresné pingnutí (users), bez duplicit. */
export function collectMentionUserIds(lidi: NudgeOsoba[]): string[] {
  const set = new Set<string>()
  for (const l of lidi) if (l.bloky.length > 0 && l.discordId) set.add(l.discordId)
  return [...set]
}
