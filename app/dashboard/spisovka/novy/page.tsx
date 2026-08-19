/**
 * app/dashboard/spisovka/novy/page.tsx
 *
 * Server Component — načte číselníky a předá do NovyDokumentForm (Client).
 */

import Link from 'next/link'
import { getVecneSkupiny, getJmennyRejstrik } from '@/lib/essl/queries'
import NovyDokumentForm from '@/components/essl/NovyDokumentForm'

export const dynamic = 'force-dynamic'

export default async function NovyDokumentPage() {
  const [vecneSkupiny, jmennyRejstrik] = await Promise.all([
    getVecneSkupiny(),
    getJmennyRejstrik(),
  ])

  return (
    <div className="px-4 py-6 lg:px-8 max-w-2xl mx-auto">
      <nav className="flex items-center gap-2 text-sm text-stone-400 dark:text-stone-500 mb-6">
        <Link href="/dashboard/spisovka" className="hover:text-stone-600 dark:hover:text-stone-300 transition-colors">
          Spisovna
        </Link>
        <span>/</span>
        <span className="text-stone-600 dark:text-stone-300">Nový dokument</span>
      </nav>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
          Nový dokument
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
          Ruční evidence — číslo jednací přidělí systém automaticky.
        </p>
      </div>
      <NovyDokumentForm
        vecneSkupiny={vecneSkupiny}
        jmennyRejstrik={jmennyRejstrik}
      />
    </div>
  )
}