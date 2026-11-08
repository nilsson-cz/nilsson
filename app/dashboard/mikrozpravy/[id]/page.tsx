// app/dashboard/mikrozpravy/[id]/page.tsx
// Detail mikrozprávy pro personál: přehled po dětech (stav, hlas, kdo) + audit.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseAdmin, createSupabaseServerClient } from '@/lib/supabase-server'
import { loadTeamReport } from '@/lib/mikrozpravy/results'
import { formatPragueTime } from '@/lib/mikrozpravy/quiet-hours'
import { TeamReportView } from '@/components/mikrozpravy/TeamReportView'

export const dynamic = 'force-dynamic'

const ACTION: Record<string, string> = {
  created: 'koncept založen', scheduled: 'naplánováno', sent: 'odesláno', cancelled: 'zrušeno',
  corrected: 'opraveno', retracted: 'staženo', failed: 'selhalo', escalated: 'eskalováno',
}

export default async function MikrozpravaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
  if (!me) redirect('/dashboard')

  const admin = createSupabaseAdmin()
  const report = await loadTeamReport(admin, id)
  if (!report) notFound()

  const { data: log } = await admin.from('micro_message_log').select('action, staff_id, detail, at').eq('message_id', id).order('at')
  const staffIds = [...new Set((log ?? []).map(l => l.staff_id).filter((x): x is string => !!x))]
  const { data: staff } = staffIds.length
    ? await admin.from('staff').select('id, first_name, last_name').in('id', staffIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] }
  const staffName = new Map((staff ?? []).map(s => [s.id, `${s.first_name} ${s.last_name}`]))

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Link href="/dashboard/mikrozpravy" className="text-sm text-gray-400 hover:text-gray-600">← Mikrozprávy</Link>
      <TeamReportView report={report} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-stone-300">Historie</h2>
        <ul className="space-y-1 text-sm text-gray-600 dark:text-stone-400">
          {(log ?? []).map((l, k) => {
            const d = new Date(l.at)
            const detail = l.detail as Record<string, unknown> | null
            return (
              <li key={k}>
                <span className="text-gray-400">{d.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })} {formatPragueTime(d, true)}</span>
                {' · '}{ACTION[l.action] ?? l.action}
                {l.staff_id ? ` · ${staffName.get(l.staff_id) ?? ''}` : ' · systém'}
                {l.action === 'sent' && detail && (
                  <span className="text-gray-400"> — {String(detail.recipients ?? 0)} rodičů, 📱 {String(detail.pushOk ?? 0)} · ✉️ {String(detail.emails ?? 0)}</span>
                )}
                {l.action === 'corrected' && detail && (
                  <span className="text-gray-400"> — původně: „{String(detail.old_body ?? '')}“</span>
                )}
                {l.action === 'failed' && detail && <span className="text-rose-600"> — {String(detail.reason ?? '')}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
