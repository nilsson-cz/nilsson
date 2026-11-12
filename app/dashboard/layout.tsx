/**
 * app/dashboard/layout.tsx
 *
 * Server Component — načte přihlášeného staff a předá do AppNav.
 * Renderuje shell: sidebar (desktop) + bottom nav (mobile) + main area.
 *
 * Struktura:
 *   lg+  →  [sidebar 240px] [main flex-1]
 *   <lg  →  [topbar] [main] [bottom-nav 64px]
 *
 * v2 — dark mode: doplněny dark: varianty na všechny hardcoded barvy
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import AppNav from '@/components/nav/AppNav'
import type { Database } from '@/types/database'
import { NilssonLogo } from '@/components/NilssonLogo'
import { jeAktivniZamestnanec } from '@/lib/role'

export type StaffRole = Database['public']['Enums']['staff_role']
export type AllRoles = StaffRole | 'vychovatel'

export type CurrentStaff = {
  id: string
  role: StaffRole
  first_name: string
  last_name: string
  email: string
  extraRoles: string[]
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staff } = await supabase
    .from('staff')
    .select('id, first_name, last_name, role, email, employment_end')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!staff) redirect('/login?error=not_staff')
  // Po konci pracovního poměru už dashboard ne (DB helpery current_staff_* vrací NULL).
  if (!jeAktivniZamestnanec(staff.employment_end)) redirect('/login?error=inactive')

  const today = new Date().toISOString().slice(0, 10)
  const { data: extraRolesRaw } = await supabase
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staff.id)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)

  // Zaměstnanec i zákonný zástupce → přepínač Škola ⇄ Rodič (jednotné přihlášení).
  // RPC zároveň napáruje rodičovský záznam podle e-mailu, pokud ještě není.
  const { data: guardianSelf } = await supabase.rpc('get_or_link_guardian_self')
  const jeRodic = (guardianSelf?.length ?? 0) > 0

  const s = staff as any
  const currentStaff: CurrentStaff = {
    id: s.id,
    first_name: s.first_name,
    last_name: s.last_name,
    role: s.role as StaffRole,
    email: s.email,
    extraRoles: (extraRolesRaw ?? []).map((r: any) => r.role),
  }

  return (
    <div className="flex h-dvh bg-stone-50 dark:bg-stone-950 overflow-hidden">
      {/* ── SIDEBAR (desktop lg+) ────────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:flex-shrink-0">
        <AppNav staff={currentStaff} variant="sidebar" prepnoutNaRodice={jeRodic} />
      </aside>

      {/* ── MAIN AREA ───────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Topbar — pouze na mobilu */}
        <header className="lg:hidden flex items-center justify-between px-4 h-14 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-700 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-orange-50 dark:bg-orange-950 flex items-center justify-center">
              <NilssonLogo size={16} />
            </div>
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">Nilsson</span>
          </div>
          <div className="flex items-center gap-3">
            {jeRodic && (
              <a href="/portal" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Rodič →
              </a>
            )}
            <span className="text-xs text-stone-500 dark:text-stone-400">
              {s.first_name} {s.last_name}
            </span>
          </div>
        </header>

        {/* Page content — scrollovatelný */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          {children}
        </main>
      </div>

      {/* ── BOTTOM NAV (mobile <lg) ──────────────────────────────────────── */}
      <div className="lg:hidden">
        <AppNav staff={currentStaff} variant="bottom" prepnoutNaRodice={jeRodic} />
      </div>
    </div>
  )
}
