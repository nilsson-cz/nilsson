import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { PortalBottomNav } from './_components/PortalBottomNav'
import { PortalSidebar } from './_components/PortalSidebar'

// app/portal/layout.tsx
// Shell pro rodičovský portál.
// Desktop: sidebar vlevo (220 px) + content vpravo.
// Mobile:  minimální topbar + fixed bottom nav.
// Dark mode: ThemeSwitcher v sidebaru (light/system/dark) — stejná logika
//            jako v personálním rozhraní (ARCH-NOTES sekce 33).
// Nástěnka = Zprávy (jeden endpoint /portal/zpravy).

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''
  if (pathname.startsWith('/portal/login')) {
    return <>{children}</>
  }

  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  const { data: guardianRows } = await supabase
    .rpc('get_or_link_guardian_self')

  const guardian = (
    guardianRows as { id: string; first_name: string; last_name: string }[] | null
  )?.[0] ?? null

  if (!guardian) redirect('/portal/login?error=not_guardian')

  const fullName = `${guardian.last_name} ${guardian.first_name}`
  const initials = `${guardian.last_name[0] ?? ''}${guardian.first_name[0] ?? ''}`

  return (
    // Třída "portal-layout" slouží jako scope pro portal-specific CSS proměnné
    // definované v globals.css — neovlivňuje personální dashboard.
    <div className="portal-layout min-h-screen bg-(--portal-bg) flex">

      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      {/* Na mobile skryt — přebírá PortalBottomNav */}
      <PortalSidebar
        fullName={fullName}
        initials={initials}
        className="hidden sm:flex"
      />

      {/* ── Hlavní oblast ─────────────────────────────────────────────────  */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Mobile topbar — pouze na malých obrazovkách */}
        <header className="sm:hidden bg-(--portal-surface) border-b border-(--portal-border)
          sticky top-0 z-10 h-12 flex items-center justify-between px-4">
          <span className="font-medium text-(--portal-text) text-sm">ZŠ Vilekula</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-(--portal-text-muted)">{guardian.last_name}</span>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="text-xs text-(--portal-text-subtle) hover:text-(--portal-text-muted)
                  transition-colors"
              >
                Odhlásit
              </button>
            </form>
          </div>
        </header>

        {/* Content — padding-bottom pro bottom nav na mobile */}
        <main className="flex-1 px-4 py-6 pb-24 sm:pb-8 sm:px-8 max-w-3xl w-full mx-auto">
          {children}
        </main>

        <footer className="hidden sm:block text-center text-xs text-(--portal-text-subtle) py-4">
          ZŠ Vilekula Teplice &middot; Nilsson
        </footer>
      </div>

      {/* Bottom nav — pouze mobile */}
      <PortalBottomNav />
    </div>
  )
}
