/**
 * app/dashboard/zivot/page.tsx
 * Server Component — testovací stránka pro vydávání tokenů zdi „Ze života školy".
 * Guard: jen director (insert do web.access_tokens stejně vynucuje RLS admin_manage_tokens).
 * Middleware a veřejná brána /zivot jsou samostatný další krok.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import IssueTokenForm from './_components/IssueTokenForm'

export const metadata = { title: 'Ze života školy — IS Nilsson' }

export default async function ZivotPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const isDirector = (staffRaw as any)?.role === 'director'

  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Ze života školy</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Ze života školy</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Vydání ročního odkazu na zeď — testovací stránka. Middleware a veřejná brána
          zatím nejsou zapojené, tohle jen ověřuje vydávání tokenu a hash v DB.
        </p>
      </div>

      <IssueTokenForm />
    </div>
  )
}
