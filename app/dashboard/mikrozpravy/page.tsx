// app/dashboard/mikrozpravy/page.tsx
// Archiv mikrozpráv (rychlé zprávy rodičům z Discordu) — pro veškerý personál (PRD D2).
// Čtení přes RLS (mm_select_staff); počty příjemců a stavy přes admin klienta po ověření personálu.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseAdmin, createSupabaseServerClient } from '@/lib/supabase-server'
import { formatPragueTime } from '@/lib/mikrozpravy/quiet-hours'

export const metadata = { title: 'Mikrozprávy — IS Nilsson' }
export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'koncept',     cls: 'bg-gray-100 text-gray-600' },
  scheduled: { label: 'naplánováno', cls: 'bg-amber-50 text-amber-700' },
  sending:   { label: 'odesílá se',  cls: 'bg-amber-50 text-amber-700' },
  sent:      { label: 'odesláno',    cls: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'zrušeno',     cls: 'bg-gray-100 text-gray-500' },
  retracted: { label: 'staženo',     cls: 'bg-rose-50 text-rose-700' },
  failed:    { label: 'selhalo',     cls: 'bg-rose-50 text-rose-700' },
}

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: '2-digit' })} ${formatPragueTime(d)}`
}

export default async function MikrozpravyArchivPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('staff').select('id').eq('user_id', user.id).maybeSingle()
  if (!me) redirect('/dashboard')

  const { data: messages } = await supabase.from('micro_messages')
    .select('id, body, kind, urgent, status, only_author, author_staff_id, sent_at, created_at, revision')
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(100)
  const list = messages ?? []
  const ids = list.map(m => m.id)

  const admin = createSupabaseAdmin()
  const [{ data: staff }, { data: mg }, { data: recips }] = await Promise.all([
    supabase.from('staff').select('id, first_name, last_name'),
    ids.length ? admin.from('micro_message_groups').select('message_id, group_id').in('message_id', ids) : Promise.resolve({ data: [] as { message_id: string; group_id: string }[] }),
    ids.length ? admin.from('micro_recipients').select('message_id, best_state').in('message_id', ids) : Promise.resolve({ data: [] as { message_id: string; best_state: number }[] }),
  ])
  const groupIds = [...new Set((mg ?? []).map(r => r.group_id))]
  const { data: groups } = groupIds.length
    ? await admin.from('groups').select('id, name').in('id', groupIds)
    : { data: [] as { id: string; name: string }[] }

  const staffName = new Map((staff ?? []).map(s => [s.id, `${s.first_name} ${s.last_name}`]))
  const groupName = new Map((groups ?? []).map(g => [g.id, g.name]))

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Mikrozprávy</h1>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-stone-400">
          Rychlé zprávy rodičům odeslané z Discordu (<code>/rodicum</code>, <code>/anketa</code>). Posílá se z Discordu, tady je archiv a podrobnosti.
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Zatím žádné mikrozprávy.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-stone-800 dark:bg-stone-900">
                <th className="px-3 py-2">Kdy</th>
                <th className="px-3 py-2">Zpráva</th>
                <th className="px-3 py-2">Komu</th>
                <th className="px-3 py-2">Autor</th>
                <th className="px-3 py-2">Stav</th>
                <th className="px-3 py-2 text-right" title="rodiče: potvrdili / otevřeli / všichni">👍 / 👁️ / ∑</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {list.map(m => {
                const rs = (recips ?? []).filter(r => r.message_id === m.id)
                const groupsLabel = m.only_author
                  ? '🧪 test (jen autor)'
                  : (mg ?? []).filter(r => r.message_id === m.id).map(r => groupName.get(r.group_id) ?? '?').join(', ')
                const st = STATUS[m.status] ?? { label: m.status, cls: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={m.id} className="align-top hover:bg-gray-50 dark:hover:bg-stone-800/50">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{when(m.sent_at ?? m.created_at)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/mikrozpravy/${m.id}`} className="text-gray-900 hover:underline dark:text-stone-100">
                        {m.urgent ? '⚡ ' : ''}{m.kind === 'poll' ? '📊 ' : ''}{m.body.length > 90 ? m.body.slice(0, 89) + '…' : m.body}
                      </Link>
                      {m.revision > 1 && <span className="ml-1 text-xs text-gray-400">upraveno</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{groupsLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{staffName.get(m.author_staff_id) ?? ''}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">
                      {rs.length ? `${rs.filter(r => r.best_state >= 4).length} / ${rs.filter(r => r.best_state >= 3).length} / ${rs.length}` : '—'}
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
