/**
 * app/dashboard/urazy/novy/page.tsx
 * Server Component — nový záznam o úrazu. Načte aktivní žáky pro výběrník
 * (předvyplnění snapshotu) a předá je klientskému UrazForm.
 */

import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR as SCHOOL_YEAR } from '@/lib/config'
import Link from 'next/link'
import UrazForm from '../_components/UrazForm'

interface Student {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
  birth_date: string | null
}

export const metadata = { title: 'Nový úraz — IS Nilsson' }

export default async function NovyUrazPage() {
  const supabase = await createServerClient()

  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka, birth_date')
    .eq('status', 'active')
    .order('last_name')
    .returns<Student[]>()

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/urazy" className="hover:text-gray-600 transition-colors">
          Úrazy
        </Link>
        <span aria-hidden>›</span>
        <span className="text-gray-700">Nový úraz</span>
      </nav>

      <h1 className="text-xl font-semibold text-gray-900 mb-1">Nový záznam o úrazu</h1>
      <p className="text-sm text-gray-500 mb-6">Školní rok {SCHOOL_YEAR}</p>

      <UrazForm students={students ?? []} schoolYear={SCHOOL_YEAR} />
    </div>
  )
}
