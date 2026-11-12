// lib/dnes.ts
// Obrazovka „Dnes" (PRD-pwa-zamestnanci F2): čisté výpočty nad načtenými daty
// jedné třídy na jeden den — bez Supabase, testovatelné.

export type DnesZak = { id: string; first_name: string; last_name: string }
export type DnesDochazka = { student_id: string; status: string }
export type DnesOmluvenka = {
  student_id: string
  status: string            // pending | approved (ostatní se sem nemají dostat)
  je_castecna: boolean
  time_from: string | null
  time_to: string | null
}

export type DuvodChybi = 'omluven' | 'neomluven' | 'castecne' | 'dalkove' | 'hlaseno'
export type ChybiZak = { id: string; jmeno: string; duvod: DuvodChybi }
export type OmluvenkaDnes = { id: string; jmeno: string; ceka: boolean; cas: string | null }

export type SouhrnTridy = {
  pocet: number
  /** Docházka za dnešek už je zapsaná (aspoň jeden záznam). */
  dochazkaZapsana: boolean
  /** Kdo dnes chybí: ze zapsané docházky; když ještě není, z omluvenek (celodenních). */
  chybi: ChybiZak[]
  /** Omluvenky pokrývající dnešek (čekající i schválené). */
  omluvenky: OmluvenkaDnes[]
  /** Bez oběda (null = data o obědech nejsou k dispozici). */
  bezObeda: ChybiZak[] | null
  /** Kolik žáků třídy jde dnes do družiny (null = nedostupné). */
  druzina: number | null
}

export const jmeno = (z: DnesZak) => `${z.last_name} ${z.first_name}`

const DUVOD_ZE_STAVU: Record<string, DuvodChybi> = {
  absent_excused: 'omluven',
  absent_unexcused: 'neomluven',
  partially_excused: 'castecne',
  remote: 'dalkove',
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

export function souhrnTridy(i: {
  zaci: DnesZak[]
  dochazka: DnesDochazka[]
  omluvenky: DnesOmluvenka[]
  sObedem: Set<string> | null
  doDruziny: Set<string> | null
}): SouhrnTridy {
  const vTride = new Set(i.zaci.map((z) => z.id))
  const podleId = new Map(i.zaci.map((z) => [z.id, z]))
  const dochazka = i.dochazka.filter((d) => vTride.has(d.student_id))
  const omluvenky = i.omluvenky.filter(
    (o) => vTride.has(o.student_id) && (o.status === 'pending' || o.status === 'approved'),
  )
  const dochazkaZapsana = dochazka.length > 0

  let chybi: ChybiZak[]
  if (dochazkaZapsana) {
    chybi = dochazka
      .filter((d) => d.status !== 'present' && DUVOD_ZE_STAVU[d.status])
      .map((d) => ({ id: d.student_id, jmeno: jmeno(podleId.get(d.student_id)!), duvod: DUVOD_ZE_STAVU[d.status] }))
  } else {
    // Docházka ještě není → očekávaná nepřítomnost z celodenních omluvenek.
    const ids = new Set(omluvenky.filter((o) => !o.je_castecna).map((o) => o.student_id))
    chybi = [...ids].map((id) => ({ id, jmeno: jmeno(podleId.get(id)!), duvod: 'hlaseno' as const }))
  }

  const omluvenkyDnes: OmluvenkaDnes[] = omluvenky.map((o) => ({
    id: o.student_id,
    jmeno: jmeno(podleId.get(o.student_id)!),
    ceka: o.status === 'pending',
    cas: o.je_castecna && (o.time_from || o.time_to) ? `${hhmm(o.time_from) ?? ''}–${hhmm(o.time_to) ?? ''}` : null,
  }))

  const bezObeda = i.sObedem
    ? i.zaci.filter((z) => !i.sObedem!.has(z.id)).map((z) => ({ id: z.id, jmeno: jmeno(z), duvod: 'hlaseno' as const }))
    : null

  const druzina = i.doDruziny ? i.zaci.filter((z) => i.doDruziny!.has(z.id)).length : null

  const poJmenu = <T extends { jmeno: string }>(a: T, b: T) => a.jmeno.localeCompare(b.jmeno, 'cs')
  return {
    pocet: i.zaci.length,
    dochazkaZapsana,
    chybi: chybi.sort(poJmenu),
    omluvenky: omluvenkyDnes.sort(poJmenu),
    bezObeda: bezObeda?.sort(poJmenu) ?? null,
    druzina,
  }
}

/** Je den školní? Víkend nebo den v kalendáři volna → ne. */
export function jeSkolniDen(datum: string, volno: Map<string, string>): boolean {
  const den = new Date(`${datum}T12:00:00Z`).getUTCDay()
  return den !== 0 && den !== 6 && !volno.has(datum)
}

/** Příští školní den po `datum` (max. 60 dní dopředu; jinak null). */
export function pristiSkolniDen(datum: string, volno: Map<string, string>): string | null {
  const d = new Date(`${datum}T12:00:00Z`)
  for (let i = 0; i < 60; i++) {
    d.setUTCDate(d.getUTCDate() + 1)
    const s = d.toISOString().slice(0, 10)
    if (jeSkolniDen(s, volno)) return s
  }
  return null
}

/** „čtvrtek 12. listopadu" */
export function datumCesky(datum: string): string {
  return new Date(`${datum}T12:00:00Z`).toLocaleDateString('cs-CZ', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  })
}
