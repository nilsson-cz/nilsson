import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear } from '@/lib/school-year'
import DruzinaCalendar from './_components/DruzinaCalendar'
import type { DruzinaDay } from '@/app/actions/portal-druzina-dochazka'

// app/portal/druzina/dochazka/page.tsx — denní přihlašování/odhlašování do družiny
// pro zákonného zástupce. Kalendář nad ročním vzorem z přihlášky.
// Pravidla (uzávěrka 22:00 D-1, neškolní dny, auto-odhlášení omluvenkou, aktivní
// zápis) hlídají RPC z migrace 079; stránka jen zobrazuje jejich výsledek.

export const metadata = { title: 'Družina — denní přihlašování' }

type Child = { id: string; first_name: string; last_name: string }

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

export default async function PortalDruzinaDochazkaPage() {
  const supabase = await createSupabaseServerClient()
  const schoolYear = await getActiveSchoolYear()

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

  const children = ((linksRaw as { students: Child | null }[]) ?? [])
    .map((l) => l.students)
    .filter((s): s is Child => Boolean(s))
    .sort((a, b) => a.last_name.localeCompare(b.last_name, 'cs'))

  // Denní přihlašování dává smysl jen pro děti s aktivním zápisem do družiny.
  const childIds = children.map((c) => c.id)
  const { data: enrRaw } = childIds.length > 0
    ? await supabase
        .from('druzina_enrollments')
        .select('student_id')
        .in('student_id', childIds)
        .eq('school_year', schoolYear)
        .is('date_to', null)
    : { data: [] }
  const enrolledIds = new Set(((enrRaw as { student_id: string }[]) ?? []).map((e) => e.student_id))
  const enrolled = children.filter((c) => enrolledIds.has(c.id))

  if (enrolled.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-xl border border-dashed border-(--portal-border) py-12 px-4 text-center
          text-sm text-(--portal-text-subtle)">
          Žádné z vašich dětí není přihlášené do školní družiny pro rok {schoolYear}.
          <div className="mt-3">
            <Link href="/portal/druzina" className="text-(--portal-accent) hover:underline">
              Přejít na přihlášku do družiny →
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const { year, month } = pragueYearMonth()

  const { data: monthData } = await supabase.rpc('druzina_month', {
    p_student_id: enrolled[0].id,
    p_year: year,
    p_month: month,
  })
  const initialDays = (monthData as DruzinaDay[]) ?? []

  return (
    <div className="space-y-6">
      <PageHeader />

      <DruzinaCalendar
        students={enrolled}
        initialStudentId={enrolled[0].id}
        initialYear={year}
        initialMonth={month}
        initialDays={initialDays}
      />
    </div>
  )
}

function PageHeader() {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-(--portal-text-subtle) mb-1">
        <Link href="/portal/druzina" className="hover:text-(--portal-text-muted) transition-colors">
          Školní družina
        </Link>
        <span>/</span>
        <span className="text-(--portal-text-muted)">Denní přihlašování</span>
      </div>
      <h1 className="text-xl font-semibold text-(--portal-text)">Družina — přihlašování na dny</h1>
      <p className="text-sm text-(--portal-text-subtle) mt-0.5">
        Dny jsou předvyplněné podle přihlášky. Změnu (přihlásit/odhlásit) provedete nejpozději do{' '}
        <strong>22:00 předchozího dne</strong>. Celodenní omluvenka dítě z družiny odhlásí automaticky.
      </p>
    </div>
  )
}
