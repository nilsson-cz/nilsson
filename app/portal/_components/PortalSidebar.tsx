'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PortalThemeSwitcher } from './PortalThemeSwitcher'

// app/portal/_components/PortalSidebar.tsx
// Sidebar pro desktop rodičovský portál.
// Skryt na mobile (sm:flex v layout.tsx).
// Aktivní položka: --portal-accent (teal, konzistentní s personálním dashboardem).
// Nástěnka = Zprávy → jeden odkaz /portal/zpravy.

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  badgeKey?: string // budoucí: počet nezaplacených / nepřečtených
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/portal',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/portal/platby',
    label: 'Platby',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
      </svg>
    ),
  },
  {
    href: '/portal/zpravy',
    label: 'Zprávy a nástěnka',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
      </svg>
    ),
  },
  {
    href: '/portal/ze-zivota-skoly',
    label: 'Ze života školy',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-5-5L5 21" />
      </svg>
    ),
  },
  {
    href: '/portal/omluvenky',
    label: 'Omluvenky',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
      </svg>
    ),
  },
  {
    href: '/portal/dochazka',
    label: 'Docházka',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
      </svg>
    ),
  },
  {
    href: '/portal/obedy',
    label: 'Obědy',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 11h18a9 9 0 0 1-18 0Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 7c0-1 .5-1.5.5-2M12 7c0-1 .5-1.5.5-2M15.5 7c0-1 .5-1.5.5-2" />
      </svg>
    ),
  },
  {
    href: '/portal/tridnice',
    label: 'Třídnice',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    href: '/portal/tripartita',
    label: 'Tripartity',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
      </svg>
    ),
  },
  {
    href: '/portal/souhlasy',
    label: 'Souhlasy',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
  {
    href: '/portal/druzina',
    label: 'Školní družina',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-[18px] h-[18px]">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M12 21c-3.6-2.4-7.2-4.95-7.2-9A4.8 4.8 0 0 1 12 8.4a4.8 4.8 0 0 1 7.2 3.6c0 4.05-3.6 6.6-7.2 9Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.4V6M9 4.5h6" />
      </svg>
    ),
  },
]

// Sekce pro navigaci — odděluje přehledové a detailní položky
const NAV_SECTIONS = [
  { label: 'Přehled', items: ['/', '/platby', '/zpravy'] },
  { label: 'Dítě', items: ['/omluvenky', '/dochazka', '/obedy', '/tridnice', '/tripartita', '/souhlasy', '/druzina'] },
]

interface PortalSidebarProps {
  fullName: string
  initials: string
  className?: string
}

export function PortalSidebar({ fullName, initials, className = '' }: PortalSidebarProps) {
  const pathname = usePathname()

  // Aktivní položka: přesná shoda pro /portal (dashboard), prefix pro ostatní
  function isActive(href: string) {
    if (href === '/portal') return pathname === '/portal'
    return pathname.startsWith(href)
  }

  const overviewHrefs = ['/portal', '/portal/platby', '/portal/zpravy', '/portal/ze-zivota-skoly']
  const overviewItems = NAV_ITEMS.filter(i => overviewHrefs.includes(i.href))
  const childItems = NAV_ITEMS.filter(i => !overviewHrefs.includes(i.href))

  return (
    <aside className={`
      w-[220px] shrink-0 flex-col
      bg-(--portal-surface) border-r border-(--portal-border)
      sticky top-0 h-screen overflow-y-auto
      ${className}
    `}>

      {/* Logo */}
      <div className="px-4 h-14 flex items-center gap-3 border-b border-(--portal-border)">
        <div className="w-8 h-8 rounded-lg bg-(--portal-accent) flex items-center justify-center
          text-white text-sm font-medium shrink-0">
          V
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-(--portal-text) truncate">ZŠ Vilekula</div>
          <div className="text-[11px] text-(--portal-text-subtle) truncate">Rodičovský portál</div>
        </div>
      </div>

      {/* Navigace — Přehled */}
      <div className="px-3 pt-4 pb-1">
        <p className="px-1 mb-1 text-[11px] font-medium text-(--portal-text-subtle) uppercase tracking-wider">
          Přehled
        </p>
        {overviewItems.map((item) => (
          <NavItem key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </div>

      {/* Navigace — Dítě */}
      <div className="px-3 pt-3 pb-1">
        <p className="px-1 mb-1 text-[11px] font-medium text-(--portal-text-subtle) uppercase tracking-wider">
          Dítě
        </p>
        {childItems.map((item) => (
          <NavItem key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </div>

      {/* Spodní část: přepínač motivu + uživatel */}
      <div className="mt-auto border-t border-(--portal-border)">
        <div className="px-3 py-3">
          <PortalThemeSwitcher />
        </div>
        <div className="px-4 py-3 flex items-center gap-3">
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full bg-(--portal-accent-subtle) flex items-center
            justify-center text-(--portal-accent) text-xs font-medium shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-(--portal-text) truncate">{fullName}</div>
            <div className="text-[11px] text-(--portal-text-subtle)">rodič</div>
          </div>
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              title="Odhlásit se"
              className="text-(--portal-text-subtle) hover:text-(--portal-text-muted) transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
              </svg>
            </button>
          </form>
        </div>
      </div>

    </aside>
  )
}

function NavItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`
        flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors
        ${active
          ? 'bg-(--portal-accent-subtle) text-(--portal-accent) font-medium'
          : 'text-(--portal-text-muted) hover:bg-(--portal-surface-hover) hover:text-(--portal-text)'
        }
      `}
    >
      <span className="shrink-0 opacity-80">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </Link>
  )
}
