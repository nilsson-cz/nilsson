// app/tym/[sig]/page.tsx
// Týmový přehled mikrozprávy se jmény (PRD D10) — přes krátkodobý podepsaný
// odkaz z /vysledky, bez přihlášení (učitel v terénu). Jen čtení.
// Generický titulek bez OG meta → Discord unfurler nic nevytáhne; hlavičky
// (no-referrer, noindex, no-store) nastavuje next.config.ts.

import type { Metadata } from 'next'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { verifyTeamLink } from '@/lib/mikrozpravy/team-link'
import { loadTeamReport } from '@/lib/mikrozpravy/results'
import { TeamReportView } from '@/components/mikrozpravy/TeamReportView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Nilsson',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function TeamReportPage({ params }: { params: Promise<{ sig: string }> }) {
  const { sig } = await params
  const link = verifyTeamLink(sig)
  const report = link ? await loadTeamReport(createSupabaseAdmin(), link.messageId) : null

  if (!report) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="font-medium">Odkaz vypršel nebo je neplatný.</p>
        <p className="mt-1 text-sm text-gray-500">V Discordu si vyžádejte nový příkazem <code>/vysledky</code>.</p>
      </main>
    )
  }

  return <TeamReportView report={report} footer="Odkaz platí 8 hodin, nepřeposílejte ho." />
}
