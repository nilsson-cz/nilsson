import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// app/portal/dochazka/page.tsx — přehled docházky pro zákonného zástupce
// Read-only; RLS zajistí, že guardian vidí jen svá dítka

const STATUS_LABEL: Record<string, string> = {
  present:           'Přítomen/a',
  absent_excused:    'Omluven/a',
  partially_excused: 'Částečně omluven/a',
  absent_unexcused:  'Neomluven/a',
  late:              'Pozdní příchod',
  remote:            'Distančně',
}

const STATUS_CLASS: Record<string, string> = {
  present:           'text-green-700',
  absent_excused:    'text-blue-700',
  partially_excused: 'text-blue-600',
  absent_unexcused:  'text-red-700',
  late:              'text-amber-700',
  remote:            'text-purple-700',
}

export default async function PortalDochazkaPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  const guardian = guardianRaw as any
  if (!guardian) notFound()

  // Děti guardiana
  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select('student_id, students ( id, first_name, last_name )')
    .eq('guardian_id', guardian.id)
    .is('platnost_do', null)

  const children = ((linksRaw as any[]) ?? [])
    .map((l: any) => l.students)
    .filter(Boolean)

  if (children.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        Ve vašem profilu nejsou evidována žádná dítka.
      </div>
    )
  }

  // Záznamy docházky za posledních 60 dní pro všechna dítka
  const since = new Date()
  since.setDate(since.getDate() - 60)
  const sinceStr = since.toISOString().slice(0, 10)

  const childIds = children.map((c: any) => c.id)

  const { data: recordsRaw } = await supabase
    .from('attendance_records')
    .select('student_id, date, status, hodiny, note, absence_request_id')
    .in('student_id', childIds)
    .gte('date', sinceStr)
    .order('date', { ascending: false })

  const records = (recordsRaw as any[]) ?? []

  // Souhrn absencí per dítě
  const summaryByChild: Record<string, { excused: number; unexcused: number }> = {}
  for (const rec of records) {
    if (!summaryByChild[rec.student_id]) {
      summaryByChild[rec.student_id] = { excused: 0, unexcused: 0 }
    }
    if (rec.status === 'absent_excused' || rec.status === 'partially_excused')
      summaryByChild[rec.student_id].excused += (rec.hodiny ?? 0)
    if (rec.status === 'absent_unexcused') summaryByChild[rec.student_id].unexcused += (rec.hodiny ?? 0)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Docházka</h1>
      <p className="text-sm text-gray-400">Záznamy za posledních 60 dní.</p>

      {children.map((child: any) => {
        const childRecords = records.filter(r => r.student_id === child.id)
        const summary = summaryByChild[child.id] ?? { excused: 0, unexcused: 0 }

        return (
          <div key={child.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Hlavička dítěte */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-medium text-gray-900">
                {child.last_name} {child.first_name}
              </h2>
              <div className="flex gap-4 text-xs text-gray-500">
                <span>
                  <span className="font-medium text-blue-700">{summary.excused}</span> hod. omluveno
                </span>
                {summary.unexcused > 0 && (
                  <span>
                    <span className="font-medium text-red-700">{summary.unexcused}</span> hod. neomluveno
                  </span>
                )}
              </div>
            </div>

            {/* Záznamy */}
            {childRecords.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-400 text-center">
                Žádné záznamy za posledních 60 dní.
              </p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {childRecords.map((rec, i) => (
                  <li key={i} className="px-5 py-3 flex items-center justify-between text-sm">
                    <span className="text-gray-500 w-32 shrink-0">
                      {new Date(rec.date).toLocaleDateString('cs-CZ', {
                        weekday: 'short', day: 'numeric', month: 'numeric'
                      })}
                    </span>
                    <span className={`font-medium ${STATUS_CLASS[rec.status] ?? 'text-gray-700'}`}>
                      {STATUS_LABEL[rec.status] ?? rec.status}
                    </span>
                    <span className="text-gray-400 text-xs text-right">
                      {rec.hodiny != null && rec.status !== 'present'
                        ? `${rec.hodiny} hod.`
                        : ''}
                      {rec.absence_request_id && (
                        <span className="ml-1 text-blue-400" title="Doloženo omluvenkou">✓</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
