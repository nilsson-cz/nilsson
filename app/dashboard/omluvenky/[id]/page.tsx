import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import ApprovalPanel from './_components/ApprovalPanel'

// /dashboard/omluvenky/[id] — Server Component
// Next.js 15+: params jako Promise (ARCH-NOTES sekce 23)

export default async function OmluvenkaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff) notFound()

  // Načíst omluvenku se všemi vazbami
  const { data: reqRaw, error } = await supabase
    .from('absence_requests')
    .select(`
      id,
      date_from,
      date_to,
      je_castecna,
      time_from,
      time_to,
      reason,
      status,
      note_internal,
      created_at,
      reviewed_at,
      student_id,
      students ( id, first_name, last_name, kod_zaka ),
      guardians:requested_by_guardian_id ( first_name, last_name, phone_primary, email ),
      entered_by:entered_by_staff_id ( first_name, last_name ),
      reviewer:reviewed_by ( first_name, last_name )
    `)
    .eq('id', id)
    .single()

  if (error || !reqRaw) notFound()

  const req      = reqRaw as any
  const student  = req.students  as any
  const guardian = req.guardians as any
  const enteredBy = req.entered_by as any
  const reviewer  = req.reviewer  as any

  // Záznamy docházky propojené s touto omluvenkou (jen po schválení)
  let attendanceRecords: any[] = []
  if (req.status === 'approved') {
    const { data: arRaw } = await supabase
      .from('attendance_records')
      .select('id, date, hodiny, status')
      .eq('absence_request_id', id)
      .order('date')
    attendanceRecords = (arRaw as any[]) ?? []
  }

  // Počet pracovních dnů v rozsahu (informativní)
  const weekdayCount = countWeekdays(new Date(req.date_from), new Date(req.date_to))

  const canApprove = ['director', 'vp', 'guide'].includes(staff.role)
    && req.status === 'pending'

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500">
        <Link href="/dashboard/omluvenky" className="hover:text-gray-700">Omluvenky</Link>
        <span className="mx-2">›</span>
        <span className="text-gray-900">
          {student?.last_name} {student?.first_name}
          {' — '}
          {new Date(req.date_from).toLocaleDateString('cs-CZ')}
          {req.date_from !== req.date_to && ` – ${new Date(req.date_to).toLocaleDateString('cs-CZ')}`}
        </span>
      </nav>

      {/* Hlavní karta */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {/* Hlavička */}
        <div className="px-6 py-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Omluvenka — {student?.last_name} {student?.first_name}
            </h1>
            {student?.kod_zaka && (
              <p className="text-sm text-gray-400 mt-0.5">{student.kod_zaka}</p>
            )}
          </div>
          <StatusBadge status={req.status} />
        </div>

        {/* Detaily */}
        <dl className="px-6 py-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-gray-500 font-medium">Zákonný zástupce</dt>
            <dd className="text-gray-900 mt-0.5">
              {guardian?.last_name} {guardian?.first_name}
              {guardian?.phone_primary && (
                <span className="block text-gray-500 text-xs mt-0.5">{guardian.phone_primary}</span>
              )}
              {guardian?.email && (
                <span className="block text-gray-500 text-xs">{guardian.email}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 font-medium">Termín</dt>
            <dd className="text-gray-900 mt-0.5">
              {req.date_from === req.date_to
                ? new Date(req.date_from).toLocaleDateString('cs-CZ')
                : `${new Date(req.date_from).toLocaleDateString('cs-CZ')} – ${new Date(req.date_to).toLocaleDateString('cs-CZ')}`}
              {req.je_castecna ? (
                <span className="text-gray-400 text-xs block mt-0.5">
                  část dne {hhmm(req.time_from)}–{hhmm(req.time_to)}
                </span>
              ) : (
                <span className="text-gray-400 text-xs block mt-0.5">
                  {weekdayCount} {weekdayCount === 1 ? 'pracovní den' : weekdayCount <= 4 ? 'pracovní dny' : 'pracovních dnů'}
                </span>
              )}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-gray-500 font-medium">Důvod</dt>
            <dd className="text-gray-900 mt-0.5">{req.reason}</dd>
          </div>
          <div>
            <dt className="text-gray-500 font-medium">Zadal/a</dt>
            <dd className="text-gray-900 mt-0.5">
              {enteredBy?.last_name} {enteredBy?.first_name}
              <span className="text-gray-400 text-xs block mt-0.5">
                {new Date(req.created_at).toLocaleString('cs-CZ')}
              </span>
            </dd>
          </div>
          {reviewer && (
            <div>
              <dt className="text-gray-500 font-medium">
                {req.status === 'approved' ? 'Schválil/a' : 'Zamítl/a'}
              </dt>
              <dd className="text-gray-900 mt-0.5">
                {reviewer.last_name} {reviewer.first_name}
                <span className="text-gray-400 text-xs block mt-0.5">
                  {new Date(req.reviewed_at).toLocaleString('cs-CZ')}
                </span>
              </dd>
            </div>
          )}
          {req.note_internal && (
            <div className="col-span-2">
              <dt className="text-gray-500 font-medium">Interní poznámka</dt>
              <dd className="text-gray-700 mt-0.5 bg-yellow-50 border border-yellow-100 rounded-lg px-3 py-2 text-xs">
                {req.note_internal}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Panel schválení/zamítnutí — pouze pro pending + oprávněné role */}
      {canApprove && (
        <ApprovalPanel
          absenceRequestId={id}
          weekdayCount={weekdayCount}
          jeCastecna={!!req.je_castecna}
        />
      )}

      {/* Vygenerované záznamy docházky */}
      {attendanceRecords.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-medium text-gray-900">Vygenerované záznamy docházky</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Záznamy byly automaticky vytvořeny při schválení omluvenky.
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {attendanceRecords.map((ar) => (
              <li key={ar.id} className="px-6 py-3 flex items-center justify-between text-sm">
                <span className="text-gray-900">
                  {new Date(ar.date).toLocaleDateString('cs-CZ', {
                    weekday: 'short', day: 'numeric', month: 'numeric'
                  })}
                </span>
                <span className="text-gray-500">
                  {ar.hodiny} hod. — {ar.status === 'partially_excused' ? 'částečně omluveno' : 'omluveno'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Odkaz na kartu žáka */}
      {student?.id && (
        <div className="text-sm">
          <Link
            href={`/dashboard/zaci/${student.id}`}
            className="text-indigo-600 hover:text-indigo-800"
          >
            ← Karta žáka: {student.last_name} {student.first_name}
          </Link>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pomocné komponenty (server-side — bez 'use client')
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:  { label: 'Čeká na zpracování', cls: 'bg-amber-100 text-amber-800' },
    approved: { label: 'Schváleno',           cls: 'bg-green-100 text-green-800' },
    rejected: { label: 'Zamítnuto',           cls: 'bg-red-100 text-red-800' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${cls}`}>
      {label}
    </span>
  )
}

/** 'HH:MM:SS' → 'HH:MM' (Postgres TIME může vracet sekundy). */
function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : ''
}

function countWeekdays(from: Date, to: Date): number {
  let count = 0
  const cur = new Date(from)
  cur.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  while (cur <= end) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}
