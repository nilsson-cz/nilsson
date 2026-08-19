import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import EnrollmentWizard from './_components/EnrollmentWizard'
import { jeEditovatelne, type EnrollmentStav } from '@/lib/enrollment/types'

// app/zapis/[id]/page.tsx — host dotazníkového wizardu.
// Načte žádost + řádek vlastníka, ověří oprávnění. Pokud už žádost není
// editovatelná (odeslaná/rozhodnutá), přesměruje na stavovou stránku.

export const dynamic = 'force-dynamic'

export default async function ZapisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/zapis/prihlaseni?next=${encodeURIComponent(`/zapis/${id}`)}`)
  }

  // Žádost (RLS: vlastník i spoluzástupce vidí; edituje jen vlastník)
  const { data: app } = await supabase
    .from('enrollment_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!app) notFound()

  // Řádek vlastníka pro tohoto uživatele
  const { data: owner } = await supabase
    .from('enrollment_guardians')
    .select('id, first_name, last_name, telefon, pribuzensky_vztah, datova_schranka, email, address_obec, address_ulice, address_cislo, address_psc, address_ruian_kod, address_validated_at')
    .eq('application_id', id)
    .eq('auth_user_id', user.id)
    .eq('role_v_zadosti', 'vlastnik')
    .maybeSingle()

  // Není vlastník → není co editovat, pošli na stav (spoluzástupce má náhled)
  if (!owner) {
    redirect(`/zapis/${id}/stav`)
  }

  // Už odeslaná / rozhodnutá → stavová stránka
  if (!jeEditovatelne(app.stav as EnrollmentStav)) {
    redirect(`/zapis/${id}/stav`)
  }

  // Ostatní zástupci (pro sekci "druhý zástupce")
  const { data: coGuardians } = await supabase
    .from('enrollment_guardians')
    .select('id, first_name, last_name, email, stav, role_v_zadosti')
    .eq('application_id', id)
    .neq('role_v_zadosti', 'vlastnik')
    .order('poradi', { ascending: true })

  return (
    <EnrollmentWizard
      app={app as any}
      owner={owner as any}
      coGuardians={(coGuardians as any) ?? []}
    />
  )
}
