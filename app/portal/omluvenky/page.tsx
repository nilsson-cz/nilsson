import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// app/portal/omluvenky/page.tsx — seznam omluvenek zákonného zástupce

const STATUS_LABEL: Record<string, string> = {
  pending:  'Čeká na schválení',
  approved: 'Schváleno',
  rejected: 'Zamítnuto',
}

const STATUS_CLASS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

export default async function PortalOmluvenkyPage() {
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

  // Omluvenky — RLS zajistí, že vidíme jen vlastní
  const { data: rawRequests } = await supabase
    .from('absence_requests')
    .select(`
      id,
      date_from,
      date_to,
      reason,
      status,
      note_internal,
      created_at,
      students ( first_name, last_name )
    `)
    .order('created_at', { ascending: false })

  const requests = (rawRequests as any[]) ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Omluvenky</h1>
        <Link
          href="/portal/omluvenky/novy"
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Nová omluvenka
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">
          <p>Zatím žádné omluvenky</p>
          <p className="text-sm mt-1">Pomocí tlačítka výše zadejte první omluvenku.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const student = req.students as any
            const sameDay = req.date_from === req.date_to
            const termín  = sameDay
              ? new Date(req.date_from).toLocaleDateString('cs-CZ')
              : `${new Date(req.date_from).toLocaleDateString('cs-CZ')} – ${new Date(req.date_to).toLocaleDateString('cs-CZ')}`

            return (
              <div
                key={req.id}
                className="bg-white rounded-xl border border-gray-200 px-5 py-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      {student?.last_name} {student?.first_name}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">{termín}</p>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${STATUS_CLASS[req.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[req.status] ?? req.status}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{req.reason}</p>
                {/* Interní poznámka průvodce — zobrazí se jen při zamítnutí */}
                {req.status === 'rejected' && req.note_internal && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">
                    Poznámka průvodce: {req.note_internal}
                  </div>
                )}
                <p className="text-xs text-gray-300">
                  Zadáno {new Date(req.created_at).toLocaleDateString('cs-CZ')}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
