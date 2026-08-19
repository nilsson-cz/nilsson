/**
 * app/dashboard/muj-profil/page.tsx
 * Server Component — osobní stránka zaměstnance.
 * Zatím: vlastní GDPR souhlasy (self-service). Časem snese i další osobní věci.
 *
 * Dostupné všem rolím (v AppNav role = všechny). Gray paleta, vzor VP.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getMyStaffConsents } from '@/lib/staff-consents'
import StaffConsentToggleList from './_components/StaffConsentToggleList'

export const metadata = { title: 'Můj profil — IS Nilsson' }

export default async function MujProfilPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('first_name, last_name')
    .eq('user_id', user.id)
    .maybeSingle()
  const staff = staffRaw as any

  const consents = await getMyStaffConsents()

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Můj profil</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {staff ? `${staff.first_name} ${staff.last_name}` : 'Zaměstnanec'}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Souhlasy se zpracováním osobních údajů
        </h2>
        <StaffConsentToggleList rows={consents} />
      </section>
    </div>
  )
}
