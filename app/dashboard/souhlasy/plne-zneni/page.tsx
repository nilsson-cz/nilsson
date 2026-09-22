/**
 * app/dashboard/souhlasy/plne-zneni/page.tsx
 * Plné znění obou GDPR souhlasů (zákonní zástupci #rodice, zaměstnanci #zamestnanci)
 * + stažení formulářů. Odkazuje sem přehled souhlasů i Můj profil.
 */

import Link from 'next/link'
import {
  ParentConsentFullText,
  StaffConsentFullText,
  ConsentDocxLink,
} from '@/components/gdpr/ConsentFullText'

export const metadata = { title: 'Plné znění GDPR souhlasů — IS Nilsson' }

export default function ConsentFullTextPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/souhlasy" className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">
          ← Přehled souhlasů
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 mt-2">Plné znění GDPR souhlasů</h1>
      </div>

      <section id="rodice" className="scroll-mt-6 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 space-y-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Zákonní zástupci</p>
        <ParentConsentFullText />
        <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
          <ConsentDocxLink which="rodice" />
        </div>
      </section>

      <section id="zamestnanci" className="scroll-mt-6 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 space-y-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Zaměstnanci</p>
        <StaffConsentFullText />
        <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
          <ConsentDocxLink which="zamestnanci" />
        </div>
      </section>
    </div>
  )
}
