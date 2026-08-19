/**
 * app/dashboard/dalsi/page.tsx
 * Server Component — pedagogický rozcestník „Další agendy".
 *
 * Nárazově používané agendy pedagogů (dlaždice s piktogramy), analogicky
 * k ředitelské „Správě školy". Obsah je odvozen z jednoho zdroje pravdy
 * (components/nav/nav-items.tsx) podle rolí přihlášeného uživatele.
 *
 * Guard: alespoň jedna pedagogická role (vp/guide/assistant/readonly/vychovatel).
 * Čistý director je přesměrován na svůj rozcestník Správa školy.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { resolveNav, NavTileGrid } from '@/components/nav/nav-items'

export const metadata = { title: 'Další agendy — IS Nilsson' }

const PEDAGOG_ROLES = ['vp', 'guide', 'assistant', 'readonly', 'vychovatel']

export default async function DalsiAgendyPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staff } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!staff) redirect('/login?error=not_staff')

  const today = new Date().toISOString().slice(0, 10)
  const { data: extraRolesRaw } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('staff_id', (staff as any).id)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)

  const roleSet: string[] = [
    (staff as any).role,
    ...((extraRolesRaw ?? []).map((r: any) => r.role)),
  ]

  // Čistý ředitel (bez pedagogické role) má svůj rozcestník ve Správě školy.
  if (!roleSet.some((r) => PEDAGOG_ROLES.includes(r))) {
    redirect('/dashboard/sprava-skoly')
  }

  const { overflow } = resolveNav(roleSet)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Další agendy</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Nárazově používané agendy
        </p>
      </div>

      {overflow.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500 dark:border-stone-700 dark:text-stone-400">
          Žádné další agendy.
        </div>
      ) : (
        <NavTileGrid items={overflow} />
      )}
    </div>
  )
}
