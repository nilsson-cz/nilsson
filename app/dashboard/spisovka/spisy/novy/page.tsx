/**
 * app/dashboard/spisovka/spisy/novy/page.tsx
 *
 * Server Component — formulář pro nový spis.
 */

import Link from 'next/link'
import NovySpisForm from '@/components/essl/NovySpisForm'

export const dynamic = 'force-dynamic'

export default function NovySpisPage() {
  return (
    <div className="px-4 py-6 lg:px-8 max-w-2xl mx-auto">
      <nav className="flex items-center gap-2 text-sm text-stone-400 dark:text-stone-500 mb-6">
        <Link href="/dashboard/spisovka" className="hover:text-stone-600 dark:hover:text-stone-300 transition-colors">
          Spisovna
        </Link>
        <span>/</span>
        <Link href="/dashboard/spisovka/spisy" className="hover:text-stone-600 dark:hover:text-stone-300 transition-colors">
          Spisy
        </Link>
        <span>/</span>
        <span className="text-stone-600 dark:text-stone-300">Nový spis</span>
      </nav>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Nový spis</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
          Spisová značka se přidělí automaticky.
        </p>
      </div>
      <NovySpisForm />
    </div>
  )
}