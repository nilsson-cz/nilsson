import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import StavView from './StavView'
import { jeEditovatelne, type EnrollmentStav } from '@/lib/enrollment/types'

// app/zapis/[id]/stav/page.tsx — read-only stavová stránka žádosti.
// Sem vede: (a) host wizardu (app/zapis/[id]/page.tsx) pro spoluzástupce
// nebo pro už needitovatelnou žádost, (b) landing (app/zapis/page.tsx)
// z přehledu žádostí, jakmile žádost přestane být rozpracovaná.

export const dynamic = 'force-dynamic'

export default async function ZapisStavPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/zapis/prihlaseni?next=${encodeURIComponent(`/zapis/${id}/stav`)}`)
  }

  const { data: app } = await supabase
    .from('enrollment_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!app) notFound()

  // RLS už zajistila, že sem vidí jen vlastník nebo spoluzástupce téhle
  // žádosti (nebo personál) — zjistíme roli přihlášeného pro rozhodnutí,
  // co zobrazit (editovatelnost, pozvání dalšího zástupce).
  const { data: myGuardian } = await supabase
    .from('enrollment_guardians')
    .select('id, role_v_zadosti')
    .eq('application_id', id)
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // Vlastník s dosud editovatelnou žádostí sem nepatří — zpátky do wizardu.
  if (
    myGuardian?.role_v_zadosti === 'vlastnik' &&
    jeEditovatelne(app.stav as EnrollmentStav)
  ) {
    redirect(`/zapis/${id}`)
  }

  const { data: owner } = await supabase
    .from('enrollment_guardians')
    .select('id, first_name, last_name, telefon, pribuzensky_vztah, email, address_obec, address_ulice, address_cislo, address_psc')
    .eq('application_id', id)
    .eq('role_v_zadosti', 'vlastnik')
    .maybeSingle()

  const { data: coGuardians } = await supabase
    .from('enrollment_guardians')
    .select('id, first_name, last_name, email, stav, role_v_zadosti')
    .eq('application_id', id)
    .neq('role_v_zadosti', 'vlastnik')
    .order('poradi', { ascending: true })

  return (
    <StavView
      app={app as any}
      owner={(owner as any) ?? null}
      coGuardians={(coGuardians as any) ?? []}
      isOwner={myGuardian?.role_v_zadosti === 'vlastnik'}
    />
  )
}

// (pozn.: props jsou typované volněji přes `as any` při předání shora —
// stejná konvence jako app/zapis/[id]/page.tsx → EnrollmentWizard)
