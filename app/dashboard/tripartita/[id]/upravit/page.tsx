/**
 * app/dashboard/tripartita/[id]/upravit/page.tsx
 * Server Component — wrapper pro EditEventForm.
 * Pouze director.
 */

import { notFound, redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import EditEventForm from './_components/EditEventForm'

export default async function TripartitaUpravitPage({
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
    .select('role')
    .eq('user_id', user.id)
    .single()

  if ((staffRaw as any)?.role !== 'director') redirect(`/dashboard/tripartita/${id}`)

  const { data: eventRaw } = await supabase
    .from('tripartita_events')
    .select('id, name, description, active, school_year')
    .eq('id', id)
    .single()

  if (!eventRaw) notFound()

  const { data: slotsRaw } = await supabase
    .from('tripartita_slots')
    .select('id, label, starts_at, ends_at, capacity, reserved_count')
    .eq('event_id', id)
    .order('starts_at', { ascending: true, nullsFirst: false })

  return (
    <EditEventForm
      event={eventRaw as any}
      slots={(slotsRaw as any[]) ?? []}
    />
  )
}
