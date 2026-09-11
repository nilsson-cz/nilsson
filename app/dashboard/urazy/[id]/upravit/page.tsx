/**
 * app/dashboard/urazy/[id]/upravit/page.tsx
 * Server Component — úprava existujícího záznamu o úrazu (reuse UrazForm).
 * Odeslaný záznam (odeslano_csi_at) je právní dokument — úpravu blokujeme.
 */

import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR as SCHOOL_YEAR } from '@/lib/config'
import { formatPoradove, type UrazZaznam } from '@/lib/urazy'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import UrazForm from '../../_components/UrazForm'

interface PageProps {
  params: Promise<{ id: string }>
}

interface Student {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
  birth_date: string | null
}

export const metadata = { title: 'Úprava úrazu — IS Nilsson' }

export default async function UpravitUrazPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerClient()

  const { data: zaznam, error } = await supabase
    .from('urazy_zaznam')
    .select('*')
    .eq('id', id)
    .single<UrazZaznam>()

  if (error || !zaznam) notFound()

  const { data: students } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka, birth_date')
    .eq('status', 'active')
    .order('last_name')
    .returns<Student[]>()

  const zamceno = Boolean(zaznam.odeslano_csi_at)

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/urazy" className="hover:text-gray-600 transition-colors">
          Úrazy
        </Link>
        <span aria-hidden>›</span>
        <Link href={`/dashboard/urazy/${id}`} className="hover:text-gray-600 transition-colors">
          {formatPoradove(zaznam.poradove_cislo, zaznam.skolni_rok)}
        </Link>
        <span aria-hidden>›</span>
        <span className="text-gray-700">Úprava</span>
      </nav>

      <h1 className="text-xl font-semibold text-gray-900 mb-1">Úprava záznamu o úrazu</h1>
      <p className="text-sm text-gray-500 mb-6">
        {formatPoradove(zaznam.poradove_cislo, zaznam.skolni_rok)}
      </p>

      {zamceno ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Tento záznam už byl odeslán ČŠI a je uzavřen jako právní dokument. Případnou opravu řešte
          aktualizací nebo odemknutím u ČŠI (viz detail záznamu).
        </div>
      ) : (
        <UrazForm students={students ?? []} schoolYear={SCHOOL_YEAR} initial={zaznam} />
      )}
    </div>
  )
}
