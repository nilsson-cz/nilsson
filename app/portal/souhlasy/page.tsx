/**
 * app/portal/souhlasy/page.tsx
 * Server Component — přehled GDPR souhlasů pro rodiče.
 *
 * Flow:
 *  1. Načte guardiana + jeho aktivní děti (legal-rep vazba, shodná podmínka jako RPC).
 *  2. Pro každé dítě načte aktivní účely + vlastní stav přes get_consents_for_guardian.
 *  3. Client komponenta řeší výběr dítěte + trojpolový přepínač + zápis.
 *
 * Vzor: Server wrapper (data) + Client komponenta (interaktivita), jako Tripartita.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getConsentsForGuardian, type GuardianConsentRow } from '@/lib/consents'
import ConsentToggleList from './_components/ConsentToggleList'

export type ChildConsents = {
  id: string
  first_name: string
  last_name: string
  consents: GuardianConsentRow[]
}

export default async function PortalConsentsPage() {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!guardianRaw) redirect('/portal/login')
  const guardian = guardianRaw as any

  // Aktivní legal-rep vazby — stejná podmínka, jakou kontroluje RPC,
  // aby get_consents_for_guardian nikdy nedostal žáka, kterého by odmítl.
  const today = new Date().toISOString().slice(0, 10)
  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select('student_id')
    .eq('guardian_id', guardian.id)
    .eq('je_zakonny_zastupce', true)
    .or(`platnost_do.is.null,platnost_do.gte.${today}`)

  const studentIds = ((linksRaw as any[]) ?? []).map((l: any) => l.student_id)

  let children: ChildConsents[] = []
  if (studentIds.length > 0) {
    const { data: studentsRaw } = await supabase
      .from('students')
      .select('id, first_name, last_name')
      .in('id', studentIds)
      .eq('status', 'active')
      .order('last_name')

    const students = (studentsRaw as any[]) ?? []
    children = await Promise.all(
      students.map(async (s: any) => ({
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        consents: await getConsentsForGuardian(s.id),
      })),
    )
  }

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-xl mx-auto pb-28 sm:pb-8">
      <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100 mb-1">
        Souhlasy
      </h1>
      <p className="text-sm text-stone-500 dark:text-stone-400 mb-6">
        Souhlasy se zpracováním osobních údajů
      </p>

      {children.length === 0 ? (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-10 text-center">
          <div className="w-10 h-10 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            K vašemu účtu nejsou přiřazeny žádné aktivní děti.
          </p>
        </div>
      ) : (
        <ConsentToggleList childrenData={children} />
      )}
    </div>
  )
}
