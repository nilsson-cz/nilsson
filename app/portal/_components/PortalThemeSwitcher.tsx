'use client'

import { useEffect, useState } from 'react'

// app/portal/_components/PortalThemeSwitcher.tsx
// Přepínač motivu: Světlý / Auto / Tmavý.
// Zapisuje do localStorage pod klíčem 'theme' — stejný klíč jako
// personální dashboard (ARCH-NOTES sekce 33), takže volba rodiče
// a volba personálu sdílejí totéž nastavení prohlížeče.
// Třídu 'dark' přidává/odebírá na <html> elementu.

type Theme = 'light' | 'system' | 'dark'

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Světlý',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'Auto',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path strokeLinecap="round" d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Tmavý',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75 9.75 9.75 0 0 1 8.25 6c0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 12c0 5.385 4.365 9.75 9.75 9.75 4.132 0 7.686-2.572 9.002-6.248Z" />
      </svg>
    ),
  },
]

function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const useDark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', useDark)
}

export function PortalThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>('system')

  // Načti uloženou volbu při mountu
  useEffect(() => {
    const stored = (localStorage.getItem('theme') as Theme | null) ?? 'system'
    setTheme(stored)
    applyTheme(stored)
  }, [])

  // Sleduj systémové nastavení při 'system' volbě
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  function handleChange(t: Theme) {
    setTheme(t)
    localStorage.setItem('theme', t)
    applyTheme(t)
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-(--portal-text-subtle) mr-1 shrink-0">Motiv</span>
      <div className="flex gap-1 flex-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleChange(opt.value)}
            title={opt.label}
            className={`
              flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded-md
              text-[11px] border transition-colors
              ${theme === opt.value
                ? 'bg-(--portal-accent-subtle) text-(--portal-accent) border-(--portal-accent)/30 font-medium'
                : 'text-(--portal-text-subtle) border-(--portal-border) hover:bg-(--portal-surface-hover) hover:text-(--portal-text-muted)'
              }
            `}
          >
            {opt.icon}
            <span className="hidden lg:inline">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
