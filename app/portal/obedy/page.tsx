import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import LunchCalendar from './_components/LunchCalendar'
import type { LunchDay } from '@/app/actions/portal-obedy'

// app/portal/obedy/page.tsx — objednávání obědů pro zákonného zástupce.
// Kalendář (objednávání) + informativní jídelníček tohoto týdne.
// Pravidla (uzávěrka 22:00 D-1, neškolní dny, autorušení omluvenkou) hlídají
// RPC z migrace 074; stránka jen zobrazuje jejich výsledek.

export const metadata = { title: 'Obědy — ZŠ Vilekula' }

type MenuItem = { option_no: number; description: string; allergens: number[] }
type MenuDay = {
  menu_date: string
  weekday: number
  soup: string | null
  soup_allergens: number[]
  items: MenuItem[]
}

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

  // Informativní jídelníček tohoto ISO týdne (může být prázdný)
  const { data: menuData } = await supabase.rpc('get_lunch_menu_week', {})
  const menu = (menuData as MenuDay[]) ?? []

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

      <WeekMenu menu={menu} />
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

const WEEKDAY_FULL = ['', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle']

function WeekMenu({ menu }: { menu: MenuDay[] }) {
  if (menu.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-(--portal-text)">Jídelníček tento týden</h2>
      <p className="text-xs text-(--portal-text-subtle) -mt-1.5">
        Pouze informativně — objednáváte oběd na den, konkrétní jídlo si dítě vybírá na místě.
      </p>
      <div className="space-y-2">
        {menu.map((d) => (
          <div key={d.menu_date} className="rounded-xl border border-(--portal-border) bg-(--portal-surface) p-4">
            <div className="flex items-baseline justify-between mb-1.5">
              <h3 className="text-sm font-medium text-(--portal-text)">
                {WEEKDAY_FULL[d.weekday] ?? ''}
              </h3>
              <span className="text-xs text-(--portal-text-subtle)">
                {new Date(d.menu_date).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}
              </span>
            </div>
            {d.soup && (
              <p className="text-sm text-(--portal-text-muted)">
                <span className="text-(--portal-text-subtle)">Polévka:</span> {d.soup}
              </p>
            )}
            <ul className="mt-1 space-y-0.5">
              {d.items.map((it) => (
                <li key={it.option_no} className="text-sm text-(--portal-text-muted)">
                  <span className="text-(--portal-text-subtle)">{it.option_no}.</span> {it.description}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
