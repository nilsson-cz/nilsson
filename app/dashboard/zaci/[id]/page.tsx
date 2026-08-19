// app/dashboard/zaci/[id]/page.tsx
// Karta žáka — Server Component
// Vzory: createSupabaseServerClient (awaited), staff.user_id, school_year filter bez valid_to IS NULL

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { NEXT_SCHOOL_YEAR } from '@/lib/config'
import StudentConsentNotice from '@/app/dashboard/_components/StudentConsentNotice'

function formatDate(date: string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const GUARDIAN_ROLE_LABELS: Record<string, string> = {
  matka: 'Matka',
  otec: 'Otec',
  porucnik: 'Poručník',
  opatrovnik: 'Opatrovník',
  pestoun: 'Pěstoun',
  sverena_pece: 'Svěřená péče',
  jiny_zz: 'Jiný ZZ',
  kontaktni_osoba: 'Kontaktní osoba',
}

const EDUCATION_MODE_LABELS: Record<string, string> = {
  standardni: 'Standardní (§ 36)',
  jiny_zpusob: 'Jiný způsob (§ 38)',
  domaci: 'Domácí (§ 41)',
}

const SEVERITY_CLASSES: Record<string, string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  critical: 'bg-red-50 text-red-800 border-red-200',
}

export default async function ZakDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  if (!staffRaw) redirect('/login')

  const staff = staffRaw as any
  const isDirectorOrVp = staff.role === 'director' || staff.role === 'vp'

  // 1. Základní data žáka
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select(
      `id, first_name, last_name, birth_date, kod_zaka,
       status, enrollment_date, withdrawal_date,
       has_svp, education_mode`
    )
    .eq('id', id)
    .single()

  if (!student || studentError) notFound()

  // 2. Skupinová příslušnost
  //    Filtrovat POUZE přes school_year, NE přes valid_to IS NULL
  //    (produkční konvence: valid_to = '2026-08-31' pro aktivní záznamy)
  const { data: memberships } = await supabase
    .from('group_memberships')
    .select('school_year, valid_from, valid_to, group_id, groups(name)')
    .eq('student_id', id)
    .order('valid_from', { ascending: false })

  const currentMembership = (memberships as any[])?.[0] ?? null
  const activeSchoolYear = currentMembership?.school_year ?? NEXT_SCHOOL_YEAR
  const activeGroupId = currentMembership?.group_id ?? null

  // 3. Zákonní zástupci
  const { data: guardianLinks } = await supabase
    .from('student_guardian_links')
    .select(
      `role, je_zakonny_zastupce, je_primarni_kontakt,
       guardians(first_name, last_name, email, phone_primary, phone_secondary, address_street, address_city, address_zip)`
    )
    .eq('student_id', id)
    .is('platnost_do', null)
    .order('je_primarni_kontakt', { ascending: false })

  // 4. BOZP status
  const { data: bozpZaznamy } = await supabase
    .from('bozp_zaznamy')
    .select('id, datum, popis')
    .eq('school_year', activeSchoolYear)
    .order('datum', { ascending: false })

  let bozpStatus: { datum: string; popis: string } | null = null

  if (bozpZaznamy && bozpZaznamy.length > 0) {
    const bozpIds = (bozpZaznamy as any[]).map((b) => b.id)
    const { data: bozpAtt } = await supabase
      .from('bozp_attendance')
      .select('bozp_id')
      .eq('student_id', id)
      .in('bozp_id', bozpIds)

    if (bozpAtt && bozpAtt.length > 0) {
      const attIds = new Set((bozpAtt as any[]).map((a) => a.bozp_id))
      const matched = (bozpZaznamy as any[]).find((b) => attIds.has(b.id))
      if (matched) bozpStatus = { datum: matched.datum, popis: matched.popis }
    }
  }

  // 5. Souhrn docházky
  const { data: attendanceSummaries } = await supabase
    .from('semester_attendance_summary')
    .select('semester, oml_h, neoml_h, locked_at')
    .eq('student_id', id)
    .eq('school_year', activeSchoolYear)
    .order('semester', { ascending: true })

  // 6. VP alerty — pouze pro director/vp
  let vpAlerts: Array<{
    id: string; alert_type: string; severity: string; message: string; created_at: string
  }> = []

  if (isDirectorOrVp) {
    const { data } = await supabase
      .from('system_alerts')
      .select('id, alert_type, severity, message, created_at')
      .eq('entity_id', id)
      .eq('module', 'vp')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
    vpAlerts = (data as any[]) ?? []
  }

  const s = student as any
  const fullName = `${s.first_name} ${s.last_name}`

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
      <div>
        <Link href="/dashboard/zaci" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          ← Žáci
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{fullName}</h1>
          <p className="text-sm text-gray-400 mt-1 font-mono">{s.kod_zaka}</p>
        </div>
        <StudentStatusBadge status={s.status} />
      </div>

      {/* Základní údaje */}
      <Section title="Základní údaje">
        <DefinitionGrid>
          <DefItem label="Datum narození" value={formatDate(s.birth_date)} />
          <DefItem
            label="Skupina / školní rok"
            value={
              currentMembership
                ? `${currentMembership.groups?.name ?? '—'} · ${currentMembership.school_year}`
                : '—'
            }
          />
          <DefItem label="Nástup" value={formatDate(s.enrollment_date)} />
          {s.withdrawal_date && (
            <DefItem label="Ukončení" value={formatDate(s.withdrawal_date)} />
          )}
          <DefItem
            label="Způsob vzdělávání"
            value={s.education_mode ? (EDUCATION_MODE_LABELS[s.education_mode] ?? s.education_mode) : '—'}
          />
          {s.has_svp && (
            <DefItem
              label="SVP"
              value={
                <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Žák se SVP
                </span>
              }
            />
          )}
        </DefinitionGrid>

        {memberships && memberships.length > 1 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Historie skupin</p>
            <div className="space-y-1">
              {(memberships as any[]).map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{m.groups?.name ?? '?'}</span>
                  <span className="text-gray-400">{m.school_year}</span>
                  <span className="text-gray-300">
                    {formatDate(m.valid_from)}{m.valid_to ? ` – ${formatDate(m.valid_to)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Zákonní zástupci */}
      <Section title="Zákonní zástupci">
        {!guardianLinks || guardianLinks.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Žádní zákonní zástupci</p>
        ) : (
          <div className="space-y-4">
            {(guardianLinks as any[]).map((link, i) => {
              const g = link.guardians
              return (
                <div key={i} className="pb-4 last:pb-0 border-b last:border-0 border-gray-100">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="font-medium text-gray-900 text-sm">{g?.first_name} {g?.last_name}</span>
                    <span className="text-xs text-gray-400">{GUARDIAN_ROLE_LABELS[link.role] ?? link.role}</span>
                    {link.je_zakonny_zastupce && <Chip color="green">ZZ</Chip>}
                    {link.je_primarni_kontakt && <Chip color="blue">primární</Chip>}
                  </div>
                  <div className="space-y-0.5 text-sm">
                    {g?.email && <a href={`mailto:${g.email}`} className="block text-gray-600 hover:text-gray-900">{g.email}</a>}
                    {g?.phone_primary && <a href={`tel:${g.phone_primary}`} className="block text-gray-600 hover:text-gray-900">{g.phone_primary}</a>}
                    {g?.phone_secondary && <span className="block text-gray-400 text-xs">{g.phone_secondary}</span>}
                    {(g?.address_street || g?.address_city) && (
                      <span className="block text-gray-400 text-xs mt-1">
                        {[g.address_street, g.address_city, g.address_zip].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* BOZP */}
      <Section title={`BOZP · ${activeSchoolYear}`}>
        {bozpStatus ? (
          <div className="flex items-start gap-3">
            <span className="text-green-500 text-lg leading-none mt-0.5">✓</span>
            <div>
              <p className="text-sm font-medium text-gray-900">Proškolení proběhlo</p>
              <p className="text-sm text-gray-500 mt-0.5">{formatDate(bozpStatus.datum)} — {bozpStatus.popis}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-lg leading-none mt-0.5">✗</span>
            <div>
              <p className="text-sm font-medium text-gray-900">Bez záznamu BOZP</p>
              <p className="text-sm text-gray-500 mt-0.5">Žák nemá záznam BOZP pro {activeSchoolYear}.</p>
              <Link href="/dashboard/bozp/novy" className="inline-block mt-2 text-xs text-blue-600 hover:underline">
                Přidat BOZP záznam →
              </Link>
            </div>
          </div>
        )}
      </Section>

      {/* Docházka */}
      <Section title={`Docházka · ${activeSchoolYear}`}>
        {!attendanceSummaries || attendanceSummaries.length === 0 ? (
          <p className="text-sm text-gray-400 italic">Pololetí dosud neuzavřeno — žádný souhrn docházky.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {(attendanceSummaries as any[]).map((sem) => (
              <div key={sem.semester} className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 mb-2">
                  {sem.semester}. pololetí
                  {sem.locked_at && (
                    <span className="ml-1.5 font-normal text-gray-400">· uzavřeno {formatDate(sem.locked_at)}</span>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-400">Omluvené</p>
                    <p className="text-base font-semibold text-gray-900 mt-0.5">
                      {sem.oml_h != null ? `${sem.oml_h} h` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Neomluvené</p>
                    <p className={`text-base font-semibold mt-0.5 ${sem.neoml_h != null && sem.neoml_h > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {sem.neoml_h != null ? `${sem.neoml_h} h` : '—'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* VP alerty — pouze director/vp */}
      {isDirectorOrVp && (
        <Section title="Výchovné poradenství">
          {vpAlerts.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Žádné aktivní VP alerty.</p>
          ) : (
            <div className="space-y-2">
              {vpAlerts.map((alert) => (
                <div key={alert.id} className={`rounded-lg border px-4 py-3 text-sm ${SEVERITY_CLASSES[alert.severity] ?? SEVERITY_CLASSES.info}`}>
                  <p className="font-medium">{alert.message}</p>
                  <p className="text-xs mt-0.5 opacity-60">{alert.alert_type} · {formatDate(alert.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Třídní kniha */}
      <Section title="Třídní kniha">
        <p className="text-sm text-gray-500 mb-3">
          Záznamy jsou vedeny per skupina/den, ne per žák. Níže odkaz na třídní knihu skupiny{' '}
          {currentMembership
            ? `${currentMembership.groups?.name ?? ''} (${currentMembership.school_year})`
            : 'žáka'}.
        </p>
        <Link
          href={activeGroupId ? `/dashboard/tridni-kniha?group_id=${activeGroupId}` : '/dashboard/tridni-kniha'}
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
        >
          Otevřít třídní knihu →
        </Link>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </section>
  )
}

function DefinitionGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</dl>
}

function DefItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 mt-0.5">{value}</dd>
    </div>
  )
}

function Chip({ color, children }: { color: 'green' | 'blue' | 'gray'; children: React.ReactNode }) {
  const classes = {
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    gray: 'bg-gray-100 text-gray-600 border-gray-200',
  }
  return (
    <span className={`inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded border ${classes[color]}`}>
      {children}
    </span>
  )
}

function StudentStatusBadge({ status }: { status: string }) {
  const config = {
    active:    { label: 'aktivní',    classes: 'bg-green-50 text-green-700 border-green-200' },
    withdrawn: { label: 'ukončen',    classes: 'bg-gray-100 text-gray-600 border-gray-200' },
    archived:  { label: 'archivován', classes: 'bg-gray-100 text-gray-500 border-gray-200' },
  } as Record<string, { label: string; classes: string }>

  const { label, classes } = config[status] ?? { label: status, classes: 'bg-gray-100 text-gray-600 border-gray-200' }

  return (
    <span className={`self-start text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ${classes}`}>
      {label}
    </span>
  )
}

