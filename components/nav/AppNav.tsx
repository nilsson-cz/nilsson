'use client'
import { useState } from 'react'
import { NilssonLogo } from '@/components/NilssonLogo'

/**
 * components/nav/AppNav.tsx
 *
 * Navigační komponenta ve dvou variantách:
 *   variant="sidebar"  → desktop, 240px, levý panel
 *   variant="bottom"   → mobile, fixní spodní lišta
 *
 * Role-based viditelnost + dvouvrstvé menu (hlavní vs. rozcestník) — definice
 * a odvození žijí v components/nav/nav-items.tsx (jeden zdroj pravdy).
 * Sidebar i spodní lišta renderují jen HLAVNÍ položky (resolveNav().main);
 * nárazové agendy jsou dostupné přes vstupní bod rozcestníku (Další agendy /
 * Správa školy).
 *
 * v3 — extrakce nav configu do nav-items.tsx, main/overflow model
 */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { createBrowserClient } from '@supabase/ssr'
import type { CurrentStaff, AllRoles } from '@/app/dashboard/layout'
import { Icons, resolveNav } from './nav-items'

// ── ThemeToggle ───────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const options: { value: string; icon: React.ReactNode; label: string }[] = [
    { value: 'light',  icon: Icons.sun,    label: 'Světlý' },
    { value: 'system', icon: Icons.system, label: 'Systém' },
    { value: 'dark',   icon: Icons.moon,   label: 'Tmavý'  },
  ]

  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <span className="text-xs text-stone-400 mr-1">Motiv</span>
      <div className="flex gap-0.5 bg-stone-100 dark:bg-stone-800 rounded-lg p-0.5">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            title={opt.label}
            className={[
              'flex items-center justify-center w-7 h-7 rounded-md transition-colors',
              theme === opt.value
                ? 'bg-white dark:bg-stone-600 text-stone-800 dark:text-stone-100 shadow-sm'
                : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300',
            ].join(' ')}
          >
            {opt.icon}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Role label helper ─────────────────────────────────────────────────────

const ROLE_LABELS: Record<AllRoles, string> = {
  director:    'Ředitel',
  vp:          'Výchovný poradce',
  guide:       'Průvodce',
  assistant:   'Asistent pedagoga',
  readonly:    'Jen pro čtení',
  vychovatel:  'Vychovatel',
}

// ── Komponenta ────────────────────────────────────────────────────────────

type AppNavProps = {
  staff: CurrentStaff
  variant: 'sidebar' | 'bottom'
}

export default function AppNav({ staff, variant }: AppNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const extraRoles: string[] = (staff as any).extraRoles ?? []
  const roleSet: string[] = [staff.role, ...extraRoles]
  const { main } = resolveNav(roleSet)

  const displayRole = ROLE_LABELS[staff.role] ??
    (extraRoles.includes('vychovatel') ? ROLE_LABELS.vychovatel : staff.role)

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  // ── SIDEBAR ──────────────────────────────────────────────────────────────
  if (variant === 'sidebar') {
    return (
      <nav className="flex flex-col w-60 h-full bg-white dark:bg-stone-900 border-r border-stone-200 dark:border-stone-700">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-stone-100 dark:border-stone-700">
          <div className="w-8 h-8 rounded-xl bg-orange-50 dark:bg-orange-950 flex items-center justify-center shrink-0">
            <NilssonLogo size={28} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">Nilsson</div>
            <div className="text-[11px] text-stone-400 truncate">ZŠ Vilekula Teplice</div>
          </div>
        </div>

        {/* Nav položky */}
        <div className="flex-1 py-3 overflow-y-auto">
          <ul className="space-y-0.5 px-2">
            {main.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors
                    ${isActive(item.href)
                      ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-medium'
                      : 'text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100'
                    }
                  `}
                >
                  <span className={isActive(item.href) ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500'}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Uživatel + theme toggle + odhlášení */}
        <div className="border-t border-stone-100 dark:border-stone-700 px-3 py-3">
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl mb-1">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {staff.first_name[0]}{staff.last_name[0]}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                {staff.first_name} {staff.last_name}
              </div>
              <div className="text-[11px] text-stone-400 truncate">
                {displayRole}
              </div>
            </div>
          </div>

          {/* Theme toggle */}
          <ThemeToggle />

          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
          >
            <span className="text-stone-400">{Icons.logout}</span>
            Odhlásit se
          </button>
        </div>
      </nav>
    )
  }

  // ── BOTTOM NAV ────────────────────────────────────────────────────────────
  const bottomItems = main.filter((item) => item.bottomNav)
  const drawerItems = main.filter((item) => !item.bottomNav)

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-stone-900 border-t border-stone-200 dark:border-stone-700 z-50">
        <ul className="flex items-stretch h-16">
          {bottomItems.map((item) => (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`
                  flex flex-col items-center justify-center gap-0.5 h-full w-full transition-colors
                  ${isActive(item.href)
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'
                  }
                `}
              >
                <span className="w-5 h-5">{item.icon}</span>
                <span className="text-[10px] font-medium">{item.label}</span>
                {isActive(item.href) && (
                  <span className="absolute bottom-0 w-6 h-0.5 bg-emerald-600 rounded-full" />
                )}
              </Link>
            </li>
          ))}

          {drawerItems.length > 0 && (
            <li className="flex-1">
              <button
                onClick={() => setDrawerOpen(true)}
                className={`flex flex-col items-center justify-center gap-0.5 h-full w-full transition-colors ${
                  drawerOpen ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300'
                }`}
              >
                <span className="w-5 h-5">{Icons.hamburger}</span>
                <span className="text-[10px] font-medium">Více</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      {/* Drawer overlay */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="fixed bottom-16 left-0 right-0 bg-white dark:bg-stone-900 rounded-t-2xl shadow-xl z-50">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-700">
              <span className="text-sm font-semibold text-stone-700 dark:text-stone-300">Nabídka</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-stone-400 hover:text-stone-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <ul className="py-2">
              {drawerItems.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                      isActive(item.href)
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950'
                        : 'text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800'
                    }`}
                  >
                    <span className="w-5 h-5 shrink-0">{item.icon}</span>
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {/* Theme toggle + odhlášení v draweru */}
            <div className="border-t border-stone-100 dark:border-stone-700 px-5 py-3 space-y-1">
              <ThemeToggle />
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 w-full py-2 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
              >
                <span className="w-5 h-5 shrink-0 text-stone-400">{Icons.logout}</span>
                Odhlásit se
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
