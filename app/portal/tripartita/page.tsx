/**
 * app/portal/tripartita/page.tsx
 * Server Component — rezervační stránka tripartit pro rodiče.
 *
 * Flow:
 *  1. Načte aktivní událost + sloty + vlastní děti (přes Server Component wrapper)
 *  2. Rodič vybere dítě → vidí dostupné termíny
 *  3. Vybere termín → vyplní volitelnou poznámku → rezervuje
 *  4. Po úspěchu: potvrzovací obrazovka (info o emailu)
 *
 * Pozn.: Stránka je rozdělena na Server wrapper (fetchuje data) +
 *        Client komponenta (interaktivita). Vzor identický s EditEventForm.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import TripartitaReservationForm from './_components/TripartitaReservationForm'

type Slot = {
  id: string
  label: string
  starts_at: string | null
  ends_at: string | null
  capacity: number
  reserved_count: number
}

type Child = {
  id: string
  first_name: string
  last_name: string
  alreadyReserved: boolean
}

export default async function PortalTripartitaPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  // Načti guardiana
  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .single()

  if (!guardianRaw) redirect('/portal/login')
  const guardian = guardianRaw as any

  // Načti aktivní událost
  const { data: eventRaw } = await supabase
    .from('tripartita_events')
    .select('id, name, description, school_year')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!eventRaw) {
    return (
      <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-xl mx-auto">
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100 mb-2">
          Tripartity
        </h1>
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-10 text-center">
          <div className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Momentálně nejsou vypsány žádné tripartitní schůzky.
          </p>
        </div>
      </div>
    )
  }

  const event = eventRaw as any

  // Načti sloty
  const { data: slotsRaw } = await supabase
    .from('tripartita_slots')
    .select('id, label, starts_at, ends_at, capacity, reserved_count')
    .eq('event_id', event.id)
    .order('starts_at', { ascending: true, nullsFirst: false })

  const slots: Slot[] = (slotsRaw as any[]) ?? []

  // Načti vlastní děti
  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select('student_id')
    .eq('guardian_id', guardian.id)

  const studentIds = ((linksRaw as any[]) ?? []).map((l: any) => l.student_id)

  let children: Child[] = []
  if (studentIds.length > 0) {
    const { data: studentsRaw } = await supabase
      .from('students')
      .select('id, first_name, last_name')
      .in('id', studentIds)
      .eq('status', 'active')
      .order('last_name')

    // Zjisti které děti už mají rezervaci
    const { data: reservationsRaw } = await supabase
      .from('tripartita_reservations')
      .select('student_id')
      .eq('event_id', event.id)
      .eq('guardian_id', guardian.id)

    const reservedStudentIds = new Set(
      ((reservationsRaw as any[]) ?? []).map((r: any) => r.student_id)
    )

    children = ((studentsRaw as any[]) ?? []).map((s: any) => ({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      alreadyReserved: reservedStudentIds.has(s.id),
    }))
  }

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-xl mx-auto pb-28 sm:pb-8">
      <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100 mb-1">
        Tripartity
      </h1>
      <p className="text-sm text-stone-500 dark:text-stone-400 mb-6">
        Rezervace schůzky s průvodcem
      </p>

      <TripartitaReservationForm
        event={event}
        slots={slots}
        children={children}
      />
    </div>
  )
}
