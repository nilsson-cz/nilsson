// app/overeni/page.tsx — veřejné zadání ověřovacího kódu potvrzení o studiu.
// ?kod=… → přesměrování na /overeni/<kód> (kanonický tvar s pomlčkami).

import { redirect } from 'next/navigation'
import { normalizeKod, formatKod } from '@/lib/potvrzeni-o-studiu/overeni'
import { OvereniShell, KodForm } from './_components/OvereniShell'

export const metadata = { title: 'Ověření potvrzení o studiu', robots: { index: false, follow: false } }

export default async function OvereniPage({
  searchParams,
}: {
  searchParams: Promise<{ kod?: string }>
}) {
  const { kod: raw } = await searchParams
  const kod = raw ? normalizeKod(raw) : null
  if (kod) redirect(`/overeni/${formatKod(kod)}`)

  return (
    <OvereniShell>
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 space-y-3">
        <p className="text-sm text-stone-600 dark:text-stone-300">
          Zadejte ověřovací kód uvedený na potvrzení (12 znaků), nebo naskenujte QR kód.
        </p>
        <KodForm defaultValue={raw ?? ''} />
        {raw && <p className="text-sm text-red-600 dark:text-red-400">Kód nemá správný tvar.</p>}
      </div>
    </OvereniShell>
  )
}
