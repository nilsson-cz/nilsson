/**
 * app/dashboard/page.tsx
 * Server Component — hlavní přehled po přihlášení.
 *
 * Změny:
 *  - unmatched_transaction odstraněn z alertů (query i render)
 *  - MessagesWidget → BulletinWidget (posledních 5 platných příspěvků)
 *  - AttendanceWidget → PendingOmluvenkyWidget (pending omluvenky, date_from ASC, limit 10)
 *  - PaymentsWidget: zobrazuje počet nespárovaných transakcí, proklik na /dashboard/platby
 */

import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import StudentSearchWidget from '@/components/dashboard/StudentSearchWidget'
import { getActiveSchoolYear } from '@/lib/school-year'
import { getMissingTKDays } from '@/lib/tridni-kniha-missing'
import { getEnrollmentPendingDecisionCount } from '@/lib/enrollment/dashboard-queries'

type AlertGroup = {
  alert_type: string
  count: number
  entity_id: string | null
  severity: string
}

type BulletinPost = {
  id: string
  title: string
  type: string
  valid_from: string
  valid_until: string | null
  event_date: string | null
}

type PendingOmluvenka = {
  id: string
  date_from: string
  date_to: string
  reason: string
  created_at: string
  student_first_name: string
  student_last_name: string
}

async function fetchDashboardData(activeYear: string) {
  const supabase = await createSupabaseServerClient()

  const [
    { data: { user } },
    { data: alertsData },
    { data: studentsData },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('system_alerts')
      .select('alert_type, severity, entity_id')
      .is('resolved_at', null)
      .neq('alert_type', 'unmatched_transaction'),
    supabase.rpc('get_students_in_school_year' as any, { p_school_year: activeYear }),
  ])

  if (!user) redirect('/login')

  // Skupinování alertů po alert_type
  const alertMap = new Map<string, { count: number; entity_id: string | null; severity: string }>()
  for (const a of (alertsData as any[]) ?? []) {
    const existing = alertMap.get(a.alert_type)
    if (existing) {
      existing.count++
      if (a.severity === 'critical') existing.severity = 'critical'
      else if (a.severity === 'warning' && existing.severity !== 'critical') existing.severity = 'warning'
    } else {
      alertMap.set(a.alert_type, { count: 1, entity_id: a.entity_id, severity: a.severity })
    }
  }
  const alertGroups: AlertGroup[] = Array.from(alertMap.entries()).map(([alert_type, v]) => ({
    alert_type,
    ...v,
  }))

  return {
    alertGroups,
    totalAlerts: alertsData?.length ?? 0,
    studentCount: (studentsData as any)?.length ?? 0,
  }
}

async function fetchMissingTKCount(activeYear: string): Promise<{ count: number; groupId: string | null }> {
  const supabase = await createSupabaseServerClient()

  const [
    { data: skupiny },
    { data: holidays },
  ] = await Promise.all([
    supabase.from('groups').select('id').eq('school_year', activeYear),
    supabase.from('school_holidays').select('datum').eq('school_year', activeYear),
  ])

  if (!skupiny || skupiny.length === 0) return { count: 0, groupId: null }

  const holidayDays = new Set<string>((holidays ?? []).map((h: any) => String(h.datum)))

  let total = 0
  for (const skupina of skupiny) {
    const { data: zaznamy } = await supabase
      .from('tridni_kniha_zaznamy')
      .select('datum')
      .eq('school_year', activeYear)
      .eq('group_id', skupina.id)

    const existujiciDny = new Set((zaznamy ?? []).map((z: any) => z.datum as string))
    total += getMissingTKDays(activeYear, existujiciDny, holidayDays).length
  }

  const firstGroupId = skupiny[0]?.id ?? null
  return { count: total, groupId: firstGroupId }
}

async function fetchBulletinPosts(): Promise<BulletinPost[]> {
  const supabase = await createSupabaseServerClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data } = await supabase
    .from('bulletin_posts')
    .select('id, title, type, valid_from, valid_until, event_date')
    .lte('valid_from', today)
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .order('created_at', { ascending: false })
    .limit(5)

  return (data as BulletinPost[]) ?? []
}

async function fetchPendingOmluvenky(): Promise<PendingOmluvenka[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('absence_requests')
    .select(`
      id,
      date_from,
      date_to,
      reason,
      created_at,
      students!inner (
        first_name,
        last_name
      )
    `)
    .eq('status', 'pending')
    .order('date_from', { ascending: true })
    .limit(10)

  return ((data as any[]) ?? []).map((r: any) => ({
    id: r.id,
    date_from: r.date_from,
    date_to: r.date_to,
    reason: r.reason,
    created_at: r.created_at,
    student_first_name: r.students.first_name,
    student_last_name: r.students.last_name,
  }))
}

async function fetchUnmatchedCount(): Promise<number> {
  const supabase = await createSupabaseServerClient()

  const { count } = await supabase
    .from('payment_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('match_status', 'unmatched')
    .eq('ignored', false)

  return count ?? 0
}

// ── Helpers pro label a URL alertu ────────────────────────────────────────────

function alertLabel(alert_type: string): string {
  const labels: Record<string, string> = {
    missing_doc:              'BOZP',
    spz_expiry:               'ŠPZ expiry',
    spz_review_due:           'ŠPZ přehodnocení',
    ivp_overdue:              'IVP nehodnoceno',
    missing_doporuceni_spz:   'Chybí doporučení ŠPZ',
    missing_souhlas_zz:       'Chybí souhlas ZZ',
    missing_ivp:              'Chybí IVP',
  }
  return labels[alert_type] ?? alert_type
}

function alertGroupLink(alert_type: string, count: number, entity_id: string | null): string {
  if (alert_type === 'missing_doc') return '/dashboard/bozp'
  if ([
    'spz_expiry', 'spz_review_due', 'ivp_overdue',
    'missing_doporuceni_spz', 'missing_souhlas_zz', 'missing_ivp',
  ].includes(alert_type)) {
    return count === 1 && entity_id
      ? `/dashboard/vp/${entity_id}`
      : '/dashboard/vp'
  }
  return '/dashboard'
}

// ── Helpers pro formátování ────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
  })
}

function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'short',
  })
}

function bulletinTypeLabel(type: string): string {
  return type === 'event' ? 'Akce' : 'Zpráva'
}

function bulletinTypeDot(type: string): string {
  return type === 'event' ? 'bg-blue-400' : 'bg-emerald-400'
}

// ── Komponenty ────────────────────────────────────────────────────────────────

function WidgetCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-5 ${className}`}>
      {children}
    </div>
  )
}

function WidgetHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wide">{title}</h2>
      {action}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center mb-3">
        <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="text-sm text-stone-400 dark:text-stone-500">{text}</p>
    </div>
  )
}

function AlertsWidget({
  alertGroups,
  total,
  missingTK,
  enrollmentPending,
}: {
  alertGroups: AlertGroup[]
  total: number
  missingTK: number
  enrollmentPending: number
}) {
  const totalWithExtra = total + (missingTK > 0 ? 1 : 0) + (enrollmentPending > 0 ? 1 : 0)

  return (
    <WidgetCard>
      <WidgetHeader
        title="Alerty"
        action={
          totalWithExtra > 0 ? (
            <span className="text-xs font-medium text-stone-400">{totalWithExtra} aktivních</span>
          ) : null
        }
      />
      {totalWithExtra === 0 ? (
        <div className="flex items-center gap-2.5 py-3">
          <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center">
            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-stone-500 dark:text-stone-400">Žádné aktivní alerty</p>
        </div>
      ) : (
        <div className="space-y-2">
          {enrollmentPending > 0 && (
            <AlertRow
              severity="info"
              label="Nevyřízená přihláška"
              count={enrollmentPending}
              href="/dashboard/zapis?stav=k_rozhodnuti"
            />
          )}
          {missingTK > 0 && (
            <AlertRow
              severity="warning"
              label="Nedoplněná třídní kniha"
              count={missingTK}
              href="/dashboard/tridni-kniha/chybejici"
            />
          )}
          {alertGroups.map((g) => (
            <AlertRow
              key={g.alert_type}
              severity={g.severity as 'critical' | 'warning' | 'info'}
              label={alertLabel(g.alert_type)}
              count={g.count > 1 ? g.count : undefined}
              href={alertGroupLink(g.alert_type, g.count, g.entity_id)}
            />
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

function AlertRow({
  severity,
  label,
  count,
  href,
}: {
  severity: 'critical' | 'warning' | 'info'
  label: string
  count?: number
  href: string
}) {
  const styles = {
    critical: { dot: 'bg-red-500',   text: 'text-red-700',   bg: 'bg-red-50',   border: 'border-red-100' },
    warning:  { dot: 'bg-amber-400', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-100' },
    info:     { dot: 'bg-blue-400',  text: 'text-blue-700',  bg: 'bg-blue-50',  border: 'border-blue-100' },
  }[severity]

  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-xl px-3 py-2.5 border transition-opacity hover:opacity-80 ${styles.bg} ${styles.border}`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${styles.dot}`} />
        <span className={`text-sm font-medium ${styles.text}`}>{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {count !== undefined && count > 1 && (
          <span className={`text-sm font-semibold ${styles.text}`}>{count}×</span>
        )}
        <svg className={`w-4 h-4 ${styles.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  )
}

function StudentsOverviewWidget({ count, schoolYear }: { count: number; schoolYear: string }) {
  return (
    <WidgetCard>
      <WidgetHeader title="Žáci" />
      <div className="flex items-end gap-2">
        <span className="text-4xl font-bold text-stone-900 dark:text-stone-100 leading-none">{count}</span>
        <span className="text-sm text-stone-400 mb-0.5">aktivních žáků</span>
      </div>
      <p className="mt-3 text-xs text-stone-400">
        Školní rok {schoolYear} · ZŠ Vilekula Teplice
      </p>
    </WidgetCard>
  )
}

function BulletinWidget({ posts }: { posts: BulletinPost[] }) {
  return (
    <WidgetCard>
      <WidgetHeader
        title="Nástěnka"
        action={
          <Link
            href="/dashboard/bulletin"
            className="text-xs font-medium text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
          >
            Zobrazit vše →
          </Link>
        }
      />
      {posts.length === 0 ? (
        <EmptyState text="Žádné aktivní příspěvky" />
      ) : (
        <div className="space-y-1">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/dashboard/bulletin/${post.id}`}
              className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors group"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${bulletinTypeDot(post.type)}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate group-hover:text-stone-900 dark:group-hover:text-stone-100">
                  {post.title}
                </p>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                  {bulletinTypeLabel(post.type)}
                  {post.event_date && (
                    <> · {formatDateFull(post.event_date)}</>
                  )}
                </p>
              </div>
              <svg className="w-4 h-4 text-stone-300 dark:text-stone-600 shrink-0 mt-0.5 group-hover:text-stone-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

function PendingOmluvenkyWidget({ omluvenky }: { omluvenky: PendingOmluvenka[] }) {
  return (
    <WidgetCard>
      <WidgetHeader
        title="Neschválené omluvenky"
        action={
          omluvenky.length > 0 ? (
            <span className="text-xs font-medium text-amber-500">{omluvenky.length} čeká</span>
          ) : null
        }
      />
      {omluvenky.length === 0 ? (
        <EmptyState text="Žádné čekající omluvenky" />
      ) : (
        <div className="space-y-2">
          {omluvenky.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/omluvenky/${o.id}`}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 border border-amber-100 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200 truncate">
                    {o.student_first_name} {o.student_last_name}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {formatDate(o.date_from)}
                    {o.date_from !== o.date_to && <> – {formatDate(o.date_to)}</>}
                  </p>
                </div>
              </div>
              <svg className="w-4 h-4 text-amber-400 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

function PaymentsWidget({ unmatchedCount }: { unmatchedCount: number }) {
  return (
    <WidgetCard>
      <WidgetHeader title="Platby" />
      <Link
        href="/dashboard/platby"
        className="flex items-center justify-between rounded-xl px-3 py-2.5 border border-stone-100 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${unmatchedCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
            {unmatchedCount > 0
              ? `${unmatchedCount} nespárovaných transakcí`
              : 'Vše spárováno'}
          </span>
        </div>
        <svg className="w-4 h-4 text-stone-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </WidgetCard>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const activeYear = await getActiveSchoolYear()
  const { alertGroups, totalAlerts, studentCount } = await fetchDashboardData(activeYear)
  const { count: missingTK } = await fetchMissingTKCount(activeYear)
  const bulletinPosts = await fetchBulletinPosts()
  const pendingOmluvenky = await fetchPendingOmluvenky()
  const unmatchedCount = await fetchUnmatchedCount()

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role, first_name')
    .eq('user_id', user.id)
    .single()

  const staff = staffRaw as any
  const role = staff?.role
  const isDirectorOrVP = role === 'director' || role === 'vp'
  const isDirector = role === 'director'

  // Enrollment modul je director-only (viz konverzace) — alert se
  // zobrazuje jen tomu, kdo má přístup na cílovou stránku.
  const enrollmentPending = isDirector ? await getEnrollmentPendingDecisionCount() : 0

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
          Dobrý den, {staff?.first_name}
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
          {new Date().toLocaleDateString('cs-CZ', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="sm:col-span-2 lg:col-span-3">
          <StudentSearchWidget />
        </div>
        <AlertsWidget
          alertGroups={alertGroups}
          total={totalAlerts}
          missingTK={missingTK}
          enrollmentPending={enrollmentPending}
        />
        <StudentsOverviewWidget count={studentCount} schoolYear={activeYear} />
        <BulletinWidget posts={bulletinPosts} />
        <PendingOmluvenkyWidget omluvenky={pendingOmluvenky} />
        {isDirectorOrVP && <PaymentsWidget unmatchedCount={unmatchedCount} />}
      </div>
    </div>
  )
}
