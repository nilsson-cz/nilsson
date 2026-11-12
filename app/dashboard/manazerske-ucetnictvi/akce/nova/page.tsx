/**
 * app/dashboard/manazerske-ucetnictvi/akce/nova/page.tsx
 * Server Component — založení akce / grantu (F3). ?ss= předvybere SS kód z Plateb.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadMuCiselniky } from '@/lib/manazerske-ucetnictvi/report'
import AkceForm from '../../_components/AkceForm'
import { BASE, directorClient, loadSsOptions, loadZakazky } from '../../_lib'

export const metadata = { title: 'Nová akce — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

export default async function NovaAkcePage({ searchParams }: { searchParams: Promise<{ ss?: string }> }) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const sp = await searchParams
  const c = await loadMuCiselniky(supabase)
  const [ssOptions, zakazky] = await Promise.all([loadSsOptions(supabase, c.akceBySs, null), loadZakazky(supabase)])
  const ss = sp.ss && /^\d+$/.test(sp.ss) ? sp.ss : null
  const predvybrana = ss ? ssOptions.find((o) => o.ss === ss) : undefined

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <Link href={`${BASE}/akce`} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Akce a granty</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">Nová akce</h1>
      </div>
      <section className="rounded-2xl border border-gray-200 p-4 dark:border-stone-700">
        <AkceForm baseHref={`${BASE}/akce`} ssOptions={ssOptions} zakazkaOptions={zakazky}
          initial={{
            nazev: predvybrana?.popis ?? '', typ: 'akce', datumOd: '', datumDo: '', abraZakazka: '',
            ssKody: ss && predvybrana && !predvybrana.obsazeno ? [ss] : [],
            rozpocetPrijmy: '', rozpocetNaklady: '', personalniNaklady: '', personalniPeriod: '', poznamka: '',
          }} />
      </section>
    </div>
  )
}
