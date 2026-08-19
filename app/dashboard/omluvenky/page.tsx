import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// Stránka: /dashboard/omluvenky
// Server Component — žádný 'use client'
// Vzor: sekvenční fetch, (data as any[]), viz ARCH-NOTES sekce 21.2, 22.3

const STATUS_LABEL: Record<string, string> = {
  pending:  'Čeká',
  approved: 'Schváleno',
  rejected: 'Zamítnuto',
}

const STATUS_CLASS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

export default async function OmluvenkyPage() {
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

  // Načíst všechny omluvenky seřazené: nejdřív čekající, pak podle data
  const { data: rawRequests } = await supabase
    .from('absence_requests')
    .select(`
      id,
      date_from,
      date_to,
      reason,
      status,
      created_at,
      student_id,
      students ( first_name, last_name ),
      guardians:requested_by_guardian_id ( first_name, last_name ),
      entered_by:entered_by_staff_id ( first_name, last_name )
    `)
    .order('status', { ascending: true })    // pending < approved < rejected (abeceda)
    .order('created_at', { ascending: false })

  const requests = (rawRequests as any[]) ?? []
  const pendingCount = requests.filter(r => r.status === 'pending').length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Hlavička */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Omluvenky</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-amber-700 mt-0.5">
              {pendingCount} {pendingCount === 1 ? 'omluvenka čeká' : 'omluvenky čekají'} na zpracování
            </p>
          )}
        </div>
        {['director', 'vp', 'guide'].includes(staff.role) && (
          <Link
            href="/dashboard/omluvenky/novy"
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + Nová omluvenka
          </Link>
        )}
      </div>

      {/* Tabulka */}
      {requests.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">Žádné omluvenky</p>
          <p className="text-sm mt-1">Zadejte první omluvenku tlačítkem výše.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-gray-500 text-xs font-medium uppercase tracking-wide">
                <th className="text-left px-4 py-3">Žák</th>
                <th className="text-left px-4 py-3">Zákonný zástupce</th>
                <th className="text-left px-4 py-3">Termín</th>
                <th className="text-left px-4 py-3">Důvod</th>
                <th className="text-left px-4 py-3">Stav</th>
                <th className="text-left px-4 py-3">Zadal/a</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map((req) => {
                const student  = req.students  as any
                const guardian = req.guardians as any
                const enteredBy = req.entered_by as any

                const dateFrom = new Date(req.date_from)
                const dateTo   = new Date(req.date_to)
                const sameDay  = req.date_from === req.date_to

                const termín = sameDay
                  ? dateFrom.toLocaleDateString('cs-CZ')
                  : `${dateFrom.toLocaleDateString('cs-CZ')} – ${dateTo.toLocaleDateString('cs-CZ')}`

                return (
                  <tr
                    key={req.id}
                    className={`hover:bg-gray-50 transition-colors ${req.status === 'pending' ? 'bg-amber-50/40' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {student?.last_name} {student?.first_name}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {guardian?.last_name} {guardian?.first_name}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {termín}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={req.reason}>
                      {req.reason}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[req.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_LABEL[req.status] ?? req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {enteredBy?.last_name} {enteredBy?.first_name?.charAt(0)}.
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/omluvenky/${req.id}`}
                        className="text-indigo-600 hover:text-indigo-800 font-medium text-xs"
                      >
                        Detail →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
