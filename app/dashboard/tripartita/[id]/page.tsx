/**
 * app/dashboard/tripartita/[id]/page.tsx
 * Server Component — detail tripartitní události.
 * Director: vidí tlačítko Upravit.
 * VP/guide/assistant: pasivní pohled (sloty + rezervace).
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function TripartitaDetailPage({
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

  const staff = staffRaw as any
  const isDirector = staff?.role === 'director'

  // Načti událost
  const { data: eventRaw } = await supabase
    .from('tripartita_events')
    .select('id, name, description, school_year, active, created_at')
    .eq('id', id)
    .single()

  if (!eventRaw) notFound()
  const event = eventRaw as any

  // Načti sloty
  const { data: slotsRaw } = await supabase
    .from('tripartita_slots')
    .select('id, label, starts_at, ends_at, capacity, reserved_count')
    .eq('event_id', id)
    .order('starts_at', { ascending: true, nullsFirst: false })

  const slots = (slotsRaw as any[]) ?? []

  // Načti rezervace s joinovanými daty
  const { data: reservationsRaw } = await supabase
    .from('tripartita_reservations')
    .select(`
      id,
      note,
      created_at,
      slot_id,
      students!inner (
        first_name,
        last_name,
        kod_zaka
      ),
      guardians!inner (
        first_name,
        last_name,
        email
      )
    `)
    .eq('event_id', id)
    .order('created_at', { ascending: true })

  const reservations = (reservationsRaw as any[]) ?? []

  // Mapa slot_id → rezervace pro přehledné zobrazení
  const reservationsBySlot = new Map<string, any[]>()
  for (const r of reservations) {
    const list = reservationsBySlot.get(r.slot_id) ?? []
    list.push(r)
    reservationsBySlot.set(r.slot_id, list)
  }

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-4xl mx-auto">
      {/* Breadcrumb + header */}
      <div className="mb-6">
        <Link
          href="/dashboard/tripartita"
          className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 flex items-center gap-1 mb-4 transition-colors w-fit"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Tripartity
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                event.active
                  ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
                  : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${event.active ? 'bg-emerald-500' : 'bg-stone-400'}`} />
                {event.active ? 'Aktivní' : 'Archivovaná'}
              </span>
              <span className="text-xs text-stone-400 dark:text-stone-500">{event.school_year}</span>
            </div>
            <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
              {event.name}
            </h1>
            {event.description && (
              <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                {event.description}
              </p>
            )}
          </div>
          {isDirector && (
            <Link
              href={`/dashboard/tripartita/${id}/upravit`}
              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 text-sm font-medium hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Upravit
            </Link>
          )}
        </div>
      </div>

      {/* Přehled čísel */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Termínů', value: slots.length },
          { label: 'Rezervací', value: reservations.length },
          {
            label: 'Volných míst',
            value: slots.reduce((acc: number, s: any) => acc + Math.max(0, s.capacity - s.reserved_count), 0),
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-4 text-center">
            <p className="text-2xl font-bold text-stone-900 dark:text-stone-100">{value}</p>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Termíny se zanořenými rezervacemi */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
            Termíny a rezervace
          </h2>
        </div>

        {slots.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-stone-400 dark:text-stone-500">Zatím žádné termíny</p>
            {isDirector && (
              <Link
                href={`/dashboard/tripartita/${id}/upravit`}
                className="mt-2 inline-block text-sm text-orange-500 hover:text-orange-600 font-medium"
              >
                Přidat termíny →
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {slots.map((slot: any) => {
              const slotReservations = reservationsBySlot.get(slot.id) ?? []
              const isFull = slot.reserved_count >= slot.capacity

              return (
                <div key={slot.id} className="px-5 py-4">
                  {/* Slot hlavička */}
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        isFull ? 'bg-stone-300 dark:bg-stone-600' : 'bg-emerald-400'
                      }`} />
                      <span className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">
                        {slot.label}
                      </span>
                      {slot.starts_at && (
                        <span className="text-xs text-stone-400 dark:text-stone-500 shrink-0">
                          {formatDateTime(slot.starts_at)}
                        </span>
                      )}
                    </div>
                    <span className={`text-xs font-medium shrink-0 px-2 py-0.5 rounded-full ${
                      isFull
                        ? 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
                        : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
                    }`}>
                      {isFull ? 'Obsazeno' : `${slot.capacity - slot.reserved_count} / ${slot.capacity} volných`}
                    </span>
                  </div>

                  {/* Rezervace tohoto slotu */}
                  {slotReservations.length > 0 && (
                    <div className="ml-4.5 space-y-1.5 mt-2">
                      {slotReservations.map((r: any) => (
                        <div
                          key={r.id}
                          className="flex items-start gap-3 rounded-xl bg-stone-50 dark:bg-stone-800 px-3 py-2.5"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                              {r.students.first_name} {r.students.last_name}
                              <span className="ml-1.5 text-xs font-normal text-stone-400 dark:text-stone-500">
                                {r.students.kod_zaka}
                              </span>
                            </p>
                            <p className="text-xs text-stone-500 dark:text-stone-400">
                              {r.guardians.first_name} {r.guardians.last_name}
                              {r.guardians.email && (
                                <> · {r.guardians.email}</>
                              )}
                            </p>
                            {r.note && (
                              <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 italic">
                                {r.note}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-stone-400 dark:text-stone-500 shrink-0 mt-0.5">
                            {new Date(r.created_at).toLocaleDateString('cs-CZ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
