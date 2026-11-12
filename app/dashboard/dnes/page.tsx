/**
 * app/dashboard/dnes/page.tsx
 * Obrazovka „Dnes" — mobilní přehled mé třídy na dnešek (PRD-pwa-zamestnanci F2).
 * Sem otevírá appka Nilsson z plochy zaměstnance (DOMOV_APP).
 *
 *  - průvodce/asistent: své třídy (staff_groups), detail rozbalený
 *  - ředitel/VP: všechny třídy aktivního roku, sbalené na souhrnný řádek
 *  - vychovatel(ka): navíc karta Družina (očekávaní po odděleních)
 * Jen čtení existujících dat; všechny akce vedou do stávajících stránek.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getGroupsForUser, getStudentsInGroup, getAttendanceForDate } from '@/app/actions/dochazka'
import { listAllHolidays } from '@/lib/school-calendar-server'
import { getActiveSchoolYear } from '@/lib/school-year'
import { dnesPraha } from '@/lib/role'
import {
  datumCesky, jeSkolniDen, pristiSkolniDen, souhrnTridy,
  type ChybiZak, type DnesOmluvenka, type SouhrnTridy,
} from '@/lib/dnes'

export const metadata = { title: 'Dnes | Nilsson' }
export const dynamic = 'force-dynamic'

const DUVOD: Record<ChybiZak['duvod'], string> = {
  omluven: 'omluven/a',
  neomluven: 'neomluven/a',
  castecne: 'část dne',
  dalkove: 'distančně',
  hlaseno: 'hlášeno rodičem',
}

export default async function DnesPage() {
  const supabase = await createSupabaseServerClient()
  const datum = dnesPraha()

  const [{ data: { user } }, svatky] = await Promise.all([supabase.auth.getUser(), listAllHolidays()])
  const volno = new Map(svatky.map((s) => [s.datum, s.nazev]))

  // Role (layout už ověřil aktivního zaměstnance)
  const { data: staff } = await supabase.from('staff').select('id, role').eq('user_id', user!.id).maybeSingle()
  const { data: extraRaw } = await supabase
    .from('staff_roles').select('role').eq('staff_id', staff!.id)
    .lte('valid_from', datum).or(`valid_to.is.null,valid_to.gte.${datum}`)
  const jeVychovatel = (extraRaw ?? []).some((r) => r.role === 'vychovatel')
  const jeVedeni = staff!.role === 'director' || staff!.role === 'vp'

  if (!jeSkolniDen(datum, volno)) {
    const pristi = pristiSkolniDen(datum, volno)
    return (
      <Obal datum={datum}>
        <div className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 text-center">
          <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">Dnes se neučí</p>
          {volno.get(datum) && <p className="mt-1 text-sm text-stone-500">{volno.get(datum)}</p>}
          {pristi && <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">Příští školní den: <strong>{datumCesky(pristi)}</strong></p>}
        </div>
      </Obal>
    )
  }

  const tridy = await getGroupsForUser()

  // Žáci + docházka po třídách
  const poTridach = await Promise.all(
    tridy.map(async (g) => {
      const [{ students }, dochazka] = await Promise.all([getStudentsInGroup(g.id, datum), getAttendanceForDate(g.id, datum)])
      return { trida: g, zaci: students, dochazka }
    }),
  )
  const vsichniIds = poTridach.flatMap((t) => t.zaci.map((z) => z.id))

  // Omluvenky pokrývající dnešek, obědy, družina — souběžně; výpadek jedné části nesmí shodit stránku
  const [omluvenkyRes, obedyRes, druzinaRes] = await Promise.all([
    vsichniIds.length
      ? supabase.from('absence_requests')
          .select('student_id, status, je_castecna, time_from, time_to')
          .in('student_id', vsichniIds).in('status', ['pending', 'approved'])
          .lte('date_from', datum).gte('date_to', datum)
      : Promise.resolve({ data: [] as DnesOmluvenka[], error: null }),
    supabase.rpc('lunch_day_roster', { p_date: datum }),
    nactiDruzinu(supabase, datum),
  ])
  const omluvenky = (omluvenkyRes.data ?? []) as DnesOmluvenka[]
  const sObedem = obedyRes.error ? null : new Set((obedyRes.data ?? []).map((r) => r.student_id))
  const doDruziny = druzinaRes ? new Set(druzinaRes.flatMap((o) => o.ids)) : null

  const souhrny = poTridach.map((t) => ({
    trida: t.trida,
    s: souhrnTridy({ zaci: t.zaci, dochazka: t.dochazka, omluvenky, sObedem, doDruziny }),
  }))

  return (
    <Obal datum={datum}>
      {souhrny.length === 0 && !jeVychovatel && (
        <p className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-5 text-sm text-stone-600 dark:text-stone-400">
          Nemáte přiřazenou třídu. <Link href="/dashboard" className="text-emerald-700 dark:text-emerald-400 underline">Přejít na přehled</Link>
        </p>
      )}

      {souhrny.map(({ trida, s }) => (
        <KartaTridy key={trida.id} id={trida.id} nazev={trida.name} s={s} datum={datum} otevrena={!jeVedeni} />
      ))}

      {jeVychovatel && druzinaRes && (
        <section className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-stone-900 dark:text-stone-100">Družina</h2>
            <Link href="/dashboard/druzina/dochazka" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Docházka družiny →</Link>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {druzinaRes.map((o) => (
              <li key={o.id} className="flex justify-between text-stone-700 dark:text-stone-300">
                <span>{o.nazev}</span><span className="font-medium">{o.ids.length} dětí</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Obal>
  )
}

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>

/** Kdo dnes jde do družiny, po odděleních aktivního roku (null = nedostupné). */
async function nactiDruzinu(supabase: Supa, datum: string): Promise<{ id: string; nazev: string; ids: string[] }[] | null> {
  const rok = await getActiveSchoolYear()
  const { data: oddeleni, error } = await supabase.from('druzina_oddeleni').select('id, name').eq('school_year', rok).order('name')
  if (error || !oddeleni) return null
  const vysledky = await Promise.all(
    oddeleni.map(async (o) => {
      const { data, error: e } = await supabase.rpc('druzina_den_ocekavani', { p_oddeleni_id: o.id, p_datum: datum })
      if (e) return null
      return { id: o.id, nazev: o.name, ids: (data ?? []).filter((r) => r.ocekavano && !r.omluven).map((r) => r.student_id) }
    }),
  )
  return vysledky.some((v) => v === null) ? null : (vysledky as { id: string; nazev: string; ids: string[] }[])
}

function Obal({ datum, children }: { datum: string; children: React.ReactNode }) {
  return (
    <main className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Dnes</p>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100 first-letter:uppercase">{datumCesky(datum)}</h1>
      </header>
      {children}
    </main>
  )
}

function KartaTridy({ id, nazev, s, datum, otevrena }: { id: string; nazev: string; s: SouhrnTridy; datum: string; otevrena: boolean }) {
  const cekajici = s.omluvenky.filter((o) => o.ceka).length
  return (
    <details open={otevrena} className="group rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100">{nazev}</h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {s.pocet} žáků · chybí {s.chybi.length}
            {s.bezObeda && ` · bez oběda ${s.bezObeda.length}`}
            {s.druzina !== null && ` · družina ${s.druzina}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!s.dochazkaZapsana && <Stitek barva="amber">docházka</Stitek>}
          {cekajici > 0 && <Stitek barva="sky">{cekajici} omluvenky</Stitek>}
          <span className="text-stone-400 transition-transform group-open:rotate-90" aria-hidden="true">›</span>
        </div>
      </summary>

      <div className="space-y-4 border-t border-stone-100 dark:border-stone-800 p-4 text-sm">
        <Blok nadpis={s.dochazkaZapsana ? 'Chybí' : 'Docházka zatím nezapsaná — hlášená nepřítomnost'}>
          {s.chybi.length === 0
            ? <Prazdno>{s.dochazkaZapsana ? 'Všichni přítomni.' : 'Nikdo není hlášený.'}</Prazdno>
            : <Seznam polozky={s.chybi.map((c) => ({ id: c.id, text: c.jmeno, pozn: DUVOD[c.duvod] }))} />}
        </Blok>

        {s.omluvenky.length > 0 && (
          <Blok nadpis="Omluvenky na dnešek">
            <Seznam polozky={s.omluvenky.map((o) => ({ id: o.id, text: o.jmeno, pozn: [o.cas, o.ceka ? 'čeká na schválení' : null].filter(Boolean).join(' · ') }))} />
          </Blok>
        )}

        {s.bezObeda && (
          <Blok nadpis={`Bez oběda (${s.bezObeda.length})`}>
            {s.bezObeda.length === 0 ? <Prazdno>Obědvají všichni.</Prazdno> : <Seznam polozky={s.bezObeda.map((c) => ({ id: c.id, text: c.jmeno }))} />}
          </Blok>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <Akce href={`/dashboard/dochazka?group=${id}&date=${datum}`} hlavni={!s.dochazkaZapsana}>
            {s.dochazkaZapsana ? 'Upravit docházku' : 'Zapsat docházku'}
          </Akce>
          <Akce href={`/dashboard/tridni-kniha?group_id=${id}`}>Zápis dne</Akce>
          <Akce href="/dashboard/omluvenky">Omluvenky</Akce>
          <Akce href="/dashboard/obedy">Obědy</Akce>
        </div>
      </div>
    </details>
  )
}

function Blok({ nadpis, children }: { nadpis: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-400">{nadpis}</h3>
      {children}
    </div>
  )
}

function Seznam({ polozky }: { polozky: { id: string; text: string; pozn?: string }[] }) {
  return (
    <ul className="divide-y divide-stone-100 dark:divide-stone-800">
      {polozky.map((p) => (
        <li key={p.id} className="flex items-baseline justify-between gap-3 py-1.5">
          <span className="text-stone-800 dark:text-stone-200">{p.text}</span>
          {p.pozn && <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{p.pozn}</span>}
        </li>
      ))}
    </ul>
  )
}

function Prazdno({ children }: { children: React.ReactNode }) {
  return <p className="text-stone-500 dark:text-stone-400">{children}</p>
}

function Stitek({ barva, children }: { barva: 'amber' | 'sky'; children: React.ReactNode }) {
  const c = barva === 'amber'
    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    : 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c}`}>{children}</span>
}

function Akce({ href, hlavni = false, children }: { href: string; hlavni?: boolean; children: React.ReactNode }) {
  const c = hlavni
    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
    : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'
  return (
    <Link href={href} className={`rounded-xl px-3 py-2 text-center text-sm font-medium transition ${c}`}>
      {children}
    </Link>
  )
}
