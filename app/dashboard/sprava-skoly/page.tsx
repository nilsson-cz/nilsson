/**
 * app/dashboard/sprava-skoly/page.tsx
 * Server Component — director-only rozcestník „Správa školy".
 *
 * Rozcestník nárazově používaných agend (dlaždice s piktogramy) + matice
 * GDPR souhlasů zaměstnanců (zaměstnanec × účel) přímo na stránce.
 *
 * Guard: jen director (RPC get_staff_consent_overview navíc guarduje na DB).
 * Gray paleta, vzor VP / student přehledu.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getStaffConsentOverview, type StaffConsentState } from '@/lib/staff-consents'
import { resolveNav, NavTileGrid, type NavItem } from '@/components/nav/nav-items'

export const metadata = { title: 'Správa školy — IS Nilsson' }

// Dlaždice rozcestníku = nárazové ředitelské agendy odvozené z jednoho zdroje
// pravdy (components/nav/nav-items.tsx) — položky viditelné řediteli, které
// nejsou v jeho hlavním menu.
const DIRECTOR_TILES = resolveNav(['director']).overflow

// Seskupení dlaždic do logických sekcí (prezentační věc této stránky).
// Nezařazené dlaždice spadnou do fallbacku „Ostatní", takže nikdy nezmizí.
const TILE_SECTIONS: { title: string; hrefs: string[] }[] = [
  {
    title: 'Rozvrh a docházka',
    hrefs: [
      '/dashboard/rozvrh',
      '/dashboard/kalendar',
      '/dashboard/muj-rozvrh',
      '/dashboard/nepritomnost',
      '/dashboard/sprava-skoly/discord',
    ],
  },
  {
    title: 'Pedagogika a hodnocení',
    hrefs: [
      '/dashboard/mapa-pokroku',
      '/dashboard/vp',
      '/dashboard/tripartita',
      '/dashboard/tridni-kniha/priznaky',
      '/dashboard/uzavreni-pololeti',
    ],
  },
  {
    title: 'Žáci a rodiče',
    hrefs: [
      '/dashboard/zapis',
      '/dashboard/rocniky',
      '/dashboard/kontakty-rodicu',
      '/dashboard/souhlasy',
      '/dashboard/zivot',
      '/dashboard/druzina',
    ],
  },
  {
    title: 'Výkazy a provoz',
    hrefs: ['/dashboard/vykaz-ppc', '/dashboard/msmt', '/dashboard/vykaz-ku', '/dashboard/bozp', '/dashboard/provoz-sluzeb', '/dashboard/obedy', '/dashboard/sprava-skoly/obedy'],
  },
  {
    title: 'Osobní a systém',
    hrefs: ['/dashboard/muj-profil', '/dashboard/nastaveni'],
  },
]

function groupTiles(tiles: NavItem[]): { title: string; items: NavItem[] }[] {
  const byHref = new Map(tiles.map((t) => [t.href, t]))
  const used = new Set<string>()
  const groups = TILE_SECTIONS.map((s) => {
    const items = s.hrefs
      .map((h) => byHref.get(h))
      .filter((x): x is NavItem => Boolean(x))
    items.forEach((i) => used.add(i.href))
    return { title: s.title, items }
  }).filter((g) => g.items.length > 0)
  const rest = tiles.filter((t) => !used.has(t.href))
  if (rest.length > 0) groups.push({ title: 'Ostatní', items: rest })
  return groups
}

const DIRECTOR_TILE_GROUPS = groupTiles(DIRECTOR_TILES)

const ROLE_LABEL: Record<string, string> = {
  director: 'Ředitel',
  vp: 'Výchovný poradce',
  guide: 'Průvodce',
  assistant: 'Asistent pedagoga',
  readonly: 'Jen pro čtení',
}

type Column = { code: string; title: string; special_category: boolean }
type StaffRow = {
  staff_id: string
  last_name: string
  first_name: string
  role: string
  employment_end: string | null
  states: Record<string, StaffConsentState>
}

export default async function SpravaSkolyPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const isDirector = (staffRaw as any)?.role === 'director'

  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Správa školy</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const rows = await getStaffConsentOverview()

  const columns: Column[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!seen.has(r.code)) {
      seen.add(r.code)
      columns.push({ code: r.code, title: r.title, special_category: r.special_category })
    }
  }

  const byStaff = new Map<string, StaffRow>()
  for (const r of rows) {
    let s = byStaff.get(r.staff_id)
    if (!s) {
      s = {
        staff_id: r.staff_id,
        last_name: r.last_name,
        first_name: r.first_name,
        role: r.role,
        employment_end: r.employment_end,
        states: {},
      }
      byStaff.set(r.staff_id, s)
    }
    s.states[r.code] = r.state
  }
  const staff = [...byStaff.values()]
  const deniedTotal = rows.filter((r) => r.state === 'denied').length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Správa školy</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Rozcestník nárazově používaných agend
        </p>
      </div>

      <div className="space-y-7">
        {DIRECTOR_TILE_GROUPS.map((g) => (
          <section key={g.title} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-stone-500">
              {g.title}
            </h2>
            <NavTileGrid items={g.items} />
          </section>
        ))}
      </div>

      <section className="space-y-4">
        <div className="border-t border-gray-100 dark:border-stone-800 pt-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-stone-100">
            GDPR souhlasy zaměstnanců
          </h2>
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Matice zaměstnanec × účel zpracování
          </p>
        </div>

      {deniedTotal > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">Pozor:</span> {deniedTotal} {pluralNesouhlas(deniedTotal)}
          {' '}— u dotčených zaměstnanců nezveřejňujte.
        </div>
      )}

      {staff.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Žádní aktivní zaměstnanci.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left align-bottom text-xs font-medium uppercase tracking-wide text-gray-500">
                    Zaměstnanec
                  </th>
                  {columns.map((col) => (
                    <th key={col.code} className="px-3 py-3 text-left align-bottom">
                      <span className="inline-flex items-start gap-1 text-[11px] font-medium leading-tight text-gray-500">
                        {col.title}
                        {col.special_category && <LockGlyph />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {staff.map((s) => (
                  <tr key={s.staff_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-gray-900">{s.last_name} {s.first_name}</span>
                      <span className="ml-2 text-xs text-gray-400">{ROLE_LABEL[s.role] ?? s.role}</span>
                      {s.employment_end && (
                        <span className="ml-2 text-xs text-amber-600">
                          do {new Date(s.employment_end).toLocaleDateString('cs-CZ')}
                        </span>
                      )}
                    </td>
                    {columns.map((col) => (
                      <td key={col.code} className="px-3 py-3">
                        <StateCell state={s.states[col.code] ?? 'none'} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Legend />
        </>
      )}
      </section>
    </div>
  )
}

function StateCell({ state }: { state: StaffConsentState }) {
  if (state === 'denied') {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        Nesouhlas
      </span>
    )
  }
  if (state === 'granted') {
    return <span className="text-green-600" title="Souhlas">✓</span>
  }
  return <span className="text-gray-300" title="Neuděleno">—</span>
}

function LockGlyph() {
  return (
    <svg className="w-3 h-3 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="zvláštní kategorie">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">Nesouhlas</span>
        nezveřejňovat
      </span>
      <span className="inline-flex items-center gap-1.5"><span className="text-green-600">✓</span> souhlas udělen</span>
      <span className="inline-flex items-center gap-1.5"><span className="text-gray-300">—</span> neuděleno</span>
      <span className="inline-flex items-center gap-1.5"><LockGlyph /> zvláštní kategorie údajů</span>
    </div>
  )
}

function pluralNesouhlas(n: number): string {
  if (n === 1) return 'aktivní nesouhlas'
  if (n >= 2 && n <= 4) return 'aktivní nesouhlasy'
  return 'aktivních nesouhlasů'
}
