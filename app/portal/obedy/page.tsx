import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import LunchCalendar from './_components/LunchCalendar'
import WeekMenuBrowser from './_components/WeekMenuBrowser'
import type { LunchDay, LunchMenuDay } from '@/app/actions/portal-obedy'

// app/portal/obedy/page.tsx — objednávání obědů pro zákonného zástupce.
// Kalendář (objednávání) + informativní jídelníček s přepínáním týdnů.
// Pravidla (uzávěrka 22:00 D-1, neškolní dny, autorušení omluvenkou) hlídají
// RPC z migrace 074; stránka jen zobrazuje jejich výsledek.

export const metadata = { title: 'Obědy — ZŠ Vilekula' }

/** Aktuální rok/měsíc v pásmu Europe/Prague. */
function pragueYearMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  return { year: get('year'), month: get('month') }
}

/** Dnešní datum (YYYY-MM-DD) v pásmu Europe/Prague. */
function pragueTodayIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Pondělí ISO týdne obsahujícího dané datum (YYYY-MM-DD). */
function mondayOfIso(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const day = d.getDay() // 0=ne .. 6=so
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default async function PortalObedyPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  const guardian = guardianRaw as { id: string } | null
  if (!guardian) notFound()

  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select('students ( id, first_name, last_name )')
    .eq('guardian_id', guardian.id)
    .is('platnost_do', null)

  const children = ((linksRaw as { students: { id: string; first_name: string; last_name: string } | null }[]) ?? [])
    .map((l) => l.students)
    .filter((s): s is { id: string; first_name: string; last_name: string } => Boolean(s))

  if (children.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-xl border border-dashed border-(--portal-border) py-12 text-center
          text-sm text-(--portal-text-subtle)">
          Ve vašem profilu nejsou evidována žádná dítka.
        </div>
      </div>
    )
  }

  const { year, month } = pragueYearMonth()

  // Počáteční data kalendáře pro první dítě
  const { data: monthData } = await supabase.rpc('lunch_month', {
    p_student_id: children[0].id,
    p_year: year,
    p_month: month,
  })
  const initialDays = (monthData as LunchDay[]) ?? []

  // Informativní jídelníček s přepínáním týdnů.
  // Meze pro ◀ ▶ = nejstarší/nejnovější zveřejněný týden. Výchozí týden =
  // nejbližší zveřejněné menu od dneška (o víkendu/prázdninách to rovnou skočí
  // na následující školní týden), jinak pondělí aktuálního týdne.
  const todayIso = pragueTodayIso()
  const { data: boundRows } = await supabase
    .from('lunch_menu_days')
    .select('week_start')
    .order('week_start', { ascending: true })
  const weekStarts = [...new Set(((boundRows as { week_start: string }[]) ?? []).map((r) => r.week_start))]
  const minWeekStart = weekStarts[0] ?? null
  const maxWeekStart = weekStarts[weekStarts.length - 1] ?? null

  const { data: upcomingRow } = await supabase
    .from('lunch_menu_days')
    .select('week_start')
    .gte('menu_date', todayIso)
    .order('menu_date', { ascending: true })
    .limit(1)
    .maybeSingle()
  const initialWeekStart =
    (upcomingRow as { week_start: string } | null)?.week_start ?? maxWeekStart ?? mondayOfIso(todayIso)

  const { data: menuData } = await supabase.rpc('get_lunch_menu_week', {
    p_week_start: initialWeekStart,
  })
  const initialMenu = (menuData as LunchMenuDay[]) ?? []

  return (
    <div className="space-y-6">
      <PageHeader />

      <LunchCalendar
        students={children}
        initialStudentId={children[0].id}
        initialYear={year}
        initialMonth={month}
        initialDays={initialDays}
      />

      <WeekMenuBrowser
        initialWeekStart={initialWeekStart}
        initialDays={initialMenu}
        minWeekStart={minWeekStart}
        maxWeekStart={maxWeekStart}
      />
    </div>
  )
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-(--portal-text)">Obědy</h1>
      <p className="text-sm text-(--portal-text-subtle) mt-0.5">
        Objednávejte a rušte obědy nejpozději do <strong>22:00 předchozího dne</strong>.
        Celodenní omluvenka podaná do uzávěrky oběd automaticky odhlásí.
      </p>
    </div>
  )
}
