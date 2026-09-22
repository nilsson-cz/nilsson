/**
 * app/portal/souhlasy/plne-zneni/page.tsx
 * Plné znění GDPR souhlasu pro zákonné zástupce + stažení formuláře.
 */

import Link from 'next/link'
import { ParentConsentFullText, ConsentDocxLink } from '@/components/gdpr/ConsentFullText'

export const metadata = { title: 'Plné znění souhlasu — Portál' }

export default function PortalConsentFullTextPage() {
  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-xl mx-auto pb-28 sm:pb-8">
      <Link
        href="/portal/souhlasy"
        className="inline-block text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 mb-4"
      >
        ← Zpět na souhlasy
      </Link>
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-5 sm:p-6 space-y-5">
        <ParentConsentFullText />
        <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
          <ConsentDocxLink which="rodice" />
        </div>
      </div>
    </div>
  )
}
