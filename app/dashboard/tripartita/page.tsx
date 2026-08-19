/**
 * app/dashboard/tripartita/page.tsx
 * Server Component — seznam tripartitních událostí.
 * Director: vidí tlačítko Nová událost.
 * VP/guide/assistant: pasivní pohled.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export default async function TripartitaPage() {
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

  const { data: eventsRaw } = await supabase
    .from('tripartita_events')
    .select('id, name, description, school_year, active, created_at')
    .order('created_at', { ascending: false })

  const events = (eventsRaw as any[]) ?? []

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            Tripartity
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
            Rezervační systém tripartitních schůzek
          </p>
        </div>
        {isDirector && (
          <Link
            href="/dashboard/tripartita/nova"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nová událost
          </Link>
        )}
      </div>

      {/* Seznam událostí */}
      {events.length === 0 ? (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-12 text-center">
          <div className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-sm text-stone-500 dark:text-stone-400">Zatím žádné události</p>
          {isDirector && (
            <Link
              href="/dashboard/tripartita/nova"
              className="mt-3 inline-block text-sm text-orange-500 hover:text-orange-600 font-medium"
            >
              Vytvořit první událost →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event: any) => (
            <Link
              key={event.id}
              href={`/dashboard/tripartita/${event.id}`}
              className="block bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-5 hover:border-stone-300 dark:hover:border-stone-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                      event.active
                        ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${event.active ? 'bg-emerald-500' : 'bg-stone-400'}`} />
                      {event.active ? 'Aktivní' : 'Archivovaná'}
                    </span>
                    <span className="text-xs text-stone-400 dark:text-stone-500">
                      {event.school_year}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100 truncate">
                    {event.name}
                  </h2>
                  {event.description && (
                    <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5 line-clamp-1">
                      {event.description}
                    </p>
                  )}
                </div>
                <svg className="w-5 h-5 text-stone-300 dark:text-stone-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
