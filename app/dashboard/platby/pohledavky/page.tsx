/**
 * app/dashboard/platby/pohledavky/page.tsx
 *
 * Server Component — seznam všech pohledávek s filtrem typ/stav/měsíc.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type ObligationStatus = 'pending' | 'partial' | 'paid'
type ObligationType   = 'lunch' | 'event' | 'tuition' | 'druzina'

type ObligationRow = {
  id: string
  type: ObligationType
  popis: string | null
  amount: number
  due_date: string
  notified_at: string | null
  ss_kod: string | null
  student: { first_name: string; last_name: string; kod_zaka: string } | null
  matched_total: number
  status: ObligationStatus
}

type Filters = {
  school_year: string   // '2026/2027' apod. — default CURRENT_SCHOOL_YEAR
  type:   ObligationType | 'all'
  status: ObligationStatus | 'all'
  month:  string   // 'YYYY-MM' nebo 'all'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveStatus(amount: number, matchedTotal: number): ObligationStatus {
  if (matchedTotal <= 0)      return 'pending'
  if (matchedTotal < amount)  return 'partial'
  return 'paid'
}

function formatMonth(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-')
  return new Date(Number(year), Number(month) - 1).toLocaleDateString('cs-CZ', {
    month: 'long',
    year:  'numeric',
  })
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchObligations(filters: Filters): Promise<ObligationRow[]> {
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('payment_obligations')
    .select(`
      id, type, popis, amount, due_date, notified_at, ss_kod,
      students ( first_name, last_name, kod_zaka )
    `)
    .eq('school_year', filters.school_year)
    .order('due_date', { ascending: false })

  if (filters.type !== 'all') {
    query = query.eq('type', filters.type)
  }

  if (filters.month !== 'all') {
    // due_date >= první den měsíce AND <= poslední den měsíce
    const [year, month] = filters.month.split('-').map(Number)
    const from = `${filters.month}-01`
    const to   = new Date(year, month, 0).toISOString().slice(0, 10)
    query = query.gte('due_date', from).lte('due_date', to)
  }

  const { data: obligationsRaw } = await query

  // Načíst match sumy pro filtrované pohledávky
  const ids = (obligationsRaw as any[] ?? []).map((o: any) => o.id)

  let matchMap: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: matchesRaw } = await supabase
      .from('payment_matches')
      .select('obligation_id, matched_amount')
      .in('obligation_id', ids)

    ;(matchesRaw as any[] ?? []).forEach((m: any) => {
      matchMap[m.obligation_id] = (matchMap[m.obligation_id] ?? 0) + Number(m.matched_amount)
    })
  }

  const obligations: ObligationRow[] = (obligationsRaw as any[] ?? []).map((o: any) => {
    const matchedTotal = matchMap[o.id] ?? 0
    return {
      id:           o.id,
      type:         o.type,
      popis:        o.popis,
      amount:       Number(o.amount),
      due_date:     o.due_date,
      notified_at:  o.notified_at,
      ss_kod:       o.ss_kod,
      student:      o.students ?? null,
      matched_total: matchedTotal,
      status:       deriveStatus(Number(o.amount), matchedTotal),
    }
  })

  // Filtr stavu — aplikujeme po odvození (nelze v SQL)
  if (filters.status !== 'all') {
    return obligations.filter((o) => o.status === filters.status)
  }

  return obligations
}

async function fetchAvailableMonths(schoolYear: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('payment_obligations')
    .select('due_date')
    .eq('school_year', schoolYear)

  const months = new Set<string>()
  ;(data as any[] ?? []).forEach((o: any) => {
    months.add((o.due_date as string).slice(0, 7))  // 'YYYY-MM'
  })

  return Array.from(months).sort().reverse()
}

async function fetchAvailableSchoolYears(): Promise<string[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('payment_obligations')
    .select('school_year')

  const years = new Set<string>()
  ;(data as any[] ?? []).forEach((o: any) => {
    if (o.school_year) years.add(o.school_year as string)
  })

  // Vždy nabídni aktuální rok, i když v něm zatím žádná pohledávka není
  years.add(CURRENT_SCHOOL_YEAR)

  return Array.from(years).sort().reverse()
}

// ---------------------------------------------------------------------------
// UI komponenty
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ObligationStatus }) {
  const map = {
    pending: { label: 'Nesplaceno', className: 'bg-amber-50 text-amber-700' },
    partial: { label: 'Částečně',   className: 'bg-blue-50 text-blue-700' },
    paid:    { label: 'Splaceno',   className: 'bg-emerald-50 text-emerald-700' },
  }[status]
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${map.className}`}>
      {map.label}
    </span>
  )
}

function TypeBadge({ type }: { type: ObligationType }) {
  const map = {
    lunch:   { label: 'Obědy',   className: 'bg-orange-50 text-orange-700' },
    tuition: { label: 'Školné',  className: 'bg-sky-50 text-sky-700' },
    event:   { label: 'Akce',    className: 'bg-purple-50 text-purple-700' },
    druzina: { label: 'Družina', className: 'bg-teal-50 text-teal-700' },
  }[type] ?? { label: type, className: 'bg-stone-100 text-stone-600' }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${map.className}`}>
      {map.label}
    </span>
  )
}

function NotifiedBadge({ notifiedAt }: { notifiedAt: string | null }) {
  if (!notifiedAt) {
    return (
      <span className="text-xs text-stone-400">neodeslána</span>
    )
  }
  return (
    <span className="text-xs text-stone-400">
      {new Date(notifiedAt).toLocaleDateString('cs-CZ')}
    </span>
  )
}

function FilterBar({
  filters,
  months,
  years,
}: {
  filters: Filters
  months: string[]
  years: string[]
}) {
  const base = '/dashboard/platby/pohledavky'

  function url(patch: Partial<Filters>) {
    const merged = { ...filters, ...patch }
    const params = new URLSearchParams()
    // Rok se do URL vkládá vždy (default je CURRENT_SCHOOL_YEAR, ale přepnutí musí být přenositelné)
    if (merged.school_year !== CURRENT_SCHOOL_YEAR) params.set('school_year', merged.school_year)
    if (merged.type   !== 'all') params.set('type',   merged.type)
    if (merged.status !== 'all') params.set('status', merged.status)
    if (merged.month  !== 'all') params.set('month',  merged.month)
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }

  function FilterPill({
    label,
    active,
    href,
  }: {
    label: string
    active: boolean
    href: string
  }) {
    return (
      <Link
        href={href}
        className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
          active
            ? 'bg-stone-800 text-white'
            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
        }`}
      >
        {label}
      </Link>
    )
  }

  return (
    <div className="space-y-2">
      {/* Školní rok — zobraz jen když je z čeho vybírat */}
      {years.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-400 w-12">Rok</span>
          {years.map((y) => (
            <FilterPill
              key={y}
              label={y}
              active={filters.school_year === y}
              // přepnutí roku resetuje měsíc (měsíce se mezi roky liší)
              href={url({ school_year: y, month: 'all' })}
            />
          ))}
        </div>
      )}

      {/* Typ */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-stone-400 w-12">Typ</span>
        <FilterPill label="Vše"    active={filters.type === 'all'}   href={url({ type: 'all' })} />
        <FilterPill label="Obědy"   active={filters.type === 'lunch'}   href={url({ type: 'lunch' })} />
        <FilterPill label="Školné"  active={filters.type === 'tuition'} href={url({ type: 'tuition' })} />
        <FilterPill label="Akce"    active={filters.type === 'event'}   href={url({ type: 'event' })} />
        <FilterPill label="Družina" active={filters.type === 'druzina'} href={url({ type: 'druzina' })} />
      </div>

      {/* Stav */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-stone-400 w-12">Stav</span>
        <FilterPill label="Vše"        active={filters.status === 'all'}     href={url({ status: 'all' })} />
        <FilterPill label="Nesplaceno" active={filters.status === 'pending'} href={url({ status: 'pending' })} />
        <FilterPill label="Částečně"   active={filters.status === 'partial'} href={url({ status: 'partial' })} />
        <FilterPill label="Splaceno"   active={filters.status === 'paid'}    href={url({ status: 'paid' })} />
      </div>

      {/* Měsíc */}
      {months.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-400 w-12">Měsíc</span>
          <FilterPill label="Vše" active={filters.month === 'all'} href={url({ month: 'all' })} />
          {months.map((m) => (
            <FilterPill
              key={m}
              label={formatMonth(m)}
              active={filters.month === m}
              href={url({ month: m })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ObligationsTable({ obligations }: { obligations: ObligationRow[] }) {
  if (obligations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-stone-400">Žádné pohledávky neodpovídají filtru</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {obligations.map((o) => (
        <Link
          key={o.id}
          href={`/dashboard/platby/pohledavky/${o.id}`}
          className="flex items-center gap-3 rounded-xl px-4 py-3 bg-white border border-stone-100 hover:border-stone-300 hover:bg-stone-50 transition-all group"
        >
          {/* Žák */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-stone-900 truncate">
              {o.student
                ? `${o.student.last_name} ${o.student.first_name}`
                : '—'}
            </p>
            <p className="text-xs text-stone-400 truncate mt-0.5">
              {o.popis ?? '—'}
              {o.ss_kod && (
                <span className="ml-2 font-mono">{o.ss_kod}</span>
              )}
            </p>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 shrink-0">
            <TypeBadge type={o.type} />
            <StatusBadge status={o.status} />
          </div>

          {/* Notifikace */}
          <div className="shrink-0 hidden sm:block text-right w-24">
            <p className="text-xs text-stone-400">notif.</p>
            <NotifiedBadge notifiedAt={o.notified_at} />
          </div>

          {/* Částka */}
          <div className="shrink-0 text-right w-28">
            <p className="text-sm font-semibold text-stone-900">
              {o.amount} Kč
            </p>
            {o.status === 'partial' && (
              <p className="text-xs text-stone-400">
                zbývá {o.amount - o.matched_total} Kč
              </p>
            )}
            {o.status === 'paid' && (
              <p className="text-xs text-emerald-600">splaceno</p>
            )}
          </div>

          {/* Splatnost */}
          <div className="shrink-0 text-right w-20 hidden md:block">
            <p className="text-xs text-stone-400">
              {new Date(o.due_date).toLocaleDateString('cs-CZ')}
            </p>
          </div>

          <svg
            className="w-4 h-4 text-stone-300 group-hover:text-stone-500 shrink-0 transition-colors"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PohledavkyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isDir } = await supabase.rpc('is_director')
  // Demo: v read-only demu (NEXT_PUBLIC_DEMO_MODE) smí číst i readonly inspektor.
  if (!isDir && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') redirect('/dashboard')

  const params = await searchParams
  const filters: Filters = {
    school_year: params.school_year || CURRENT_SCHOOL_YEAR,
    type:   (params.type   as ObligationType) || 'all',
    status: (params.status as ObligationStatus) || 'all',
    month:  params.month || 'all',
  }

  const [obligations, months, years] = await Promise.all([
    fetchObligations(filters),
    fetchAvailableMonths(filters.school_year),
    fetchAvailableSchoolYears(),
  ])

  // Souhrnné počty pro header
  const counts = {
    pending: obligations.filter((o) => o.status === 'pending').length,
    partial: obligations.filter((o) => o.status === 'partial').length,
    paid:    obligations.filter((o) => o.status === 'paid').length,
  }

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-stone-400 mb-1">
            <Link href="/dashboard/platby" className="hover:text-stone-600 transition-colors">
              Platby
            </Link>
            <span>/</span>
            <span className="text-stone-600">Pohledávky</span>
          </div>
          <h1 className="text-xl font-semibold text-stone-900">Pohledávky</h1>
          <div className="flex items-center gap-3 mt-1.5">
            {counts.pending > 0 && (
              <span className="text-xs text-amber-600">
                {counts.pending} nesplacených
              </span>
            )}
            {counts.partial > 0 && (
              <span className="text-xs text-blue-600">
                {counts.partial} částečných
              </span>
            )}
            {counts.paid > 0 && (
              <span className="text-xs text-stone-400">
                {counts.paid} splacených
              </span>
            )}
          </div>
        </div>

        <Link
          href="/dashboard/platby/pohledavky/nova"
          className="shrink-0 text-sm font-medium bg-stone-800 text-white hover:bg-stone-700 px-4 py-2 rounded-xl transition-colors"
        >
          + Nová pohledávka
        </Link>
      </div>

      {/* Filtry */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 mb-4">
        <FilterBar filters={filters} months={months} years={years} />
      </div>

      {/* Seznam */}
      <ObligationsTable obligations={obligations} />
    </div>
  )
}