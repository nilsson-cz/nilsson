/**
 * components/nav/nav-items.tsx
 *
 * JEDEN ZDROJ PRAVDY pro navigaci učitelského dashboardu.
 *
 * Každá položka nese dva nezávislé rozměry:
 *   roles       → KDO má na položku přístup (viditelnost napříč rolemi)
 *   primaryFor  → pro KOHO je položka v HLAVNÍM menu (sidebar / spodní lišta);
 *                 kdo ji vidí, ale není v primaryFor, ji najde v rozcestníku
 *                 „nárazových" agend (ředitel → Správa školy, pedagog → Další agendy).
 *
 * Odvození bere UNION rolí uživatele (staff.role ∪ extraRoles) — pozor, vychovatel
 * je extraRole nad základní rolí, ne samostatný staff.role.
 *
 * Modul je server-safe (žádné hooky, žádné 'use client') — importuje ho jak
 * AppNav (client), tak stránky rozcestníků (server).
 */

import Link from 'next/link'
import type { AllRoles } from '@/app/dashboard/layout'

// ── Ikony (inline SVG — žádná závislost na icon library) ──────────────────

export const Icons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  students: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  book: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  attendance: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  payments: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  vp: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
  messages: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  logout: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  lock: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  hamburger: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  druzina: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.75L12 3l9 6.75V21a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H3.75A.75.75 0 013 21V9.75z" />
    </svg>
  ),
  mapaPokroku: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  sun: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  ),
  moon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  ),
  system: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  calendar: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  archive: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  ),
  clipboard: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-5 8l2 2 4-4" />
    </svg>
  ),
  photo: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  // ── nové ikony (dříve jen dlaždice ve Správě školy / nové agendy) ──────────
  more: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h4v4H4V6zm0 8h4v4H4v-4zm8-8h4v4h-4V6zm0 8h4v4h-4v-4zm8-8h.01M20 14h.01" />
    </svg>
  ),
  rozvrhTemplate: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z M4 9h16 M9 3v18" />
    </svg>
  ),
  nepritomnost: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  ),
  vykazPpc: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6h13M9 17H4a1 1 0 01-1-1V5a1 1 0 011-1h4m1 13V4m0 0h11a1 1 0 011 1v6M9 11h13M13 21h6a1 1 0 001-1v-4" />
    </svg>
  ),
  discord: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4-.8L3 20l1.2-3.6A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  msmt: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  hospitace: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
    </svg>
  ),
  server: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2M5 12h14M8 7h.01M8 17h.01" />
    </svg>
  ),
  vykazKu: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a2 2 0 012-2h2a2 2 0 012 2v2M9 7h6m-8 14h10a2 2 0 002-2V7a2 2 0 00-2-2h-2.586a1 1 0 01-.707-.293l-1.414-1.414A1 1 0 0011.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  lunch: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 11h16a8 8 0 01-16 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7c0-1 .6-1.5.6-2.5M12 7c0-1 .6-1.5.6-2.5M15 7c0-1 .6-1.5.6-2.5" />
    </svg>
  ),
  phone: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  academicCap: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.42a12 12 0 01.34 2.84c0 1.66-.13 3.29-.38 4.87M12 14L5.84 10.58a12 12 0 00-.34 2.84c0 1.66.13 3.29.38 4.87M12 14v7" />
    </svg>
  ),
}

// ── Typ nav položky ────────────────────────────────────────────────────────

export type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  /** KDO má přístup (viditelnost). */
  roles: AllRoles[]
  /** Pro koho je položka v HLAVNÍM menu; jinak spadá do rozcestníku. */
  primaryFor: AllRoles[]
  /** Popisek do dlaždice rozcestníku (jen u položek, které mohou být „overflow"). */
  desc?: string
  /** Barevný nádech dlaždice (Tailwind třídy bg/text + dark:). */
  tint?: string
  /** Zobrazit ve spodní liště na mobilu (jen položky hlavního menu). */
  bottomNav?: boolean
}

// tinty pro dlaždice rozcestníku
const T = {
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  teal:    'bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400',
  indigo:  'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400',
  orange:  'bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400',
  slate:   'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  blue:    'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
  violet:  'bg-violet-50 text-violet-600 dark:bg-violet-950 dark:text-violet-400',
  amber:   'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  rose:    'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
  sky:     'bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400',
  cyan:    'bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400',
  green:   'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950 dark:text-fuchsia-400',
  stone:   'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
} as const

// ── Definice nav položek (JEDEN ZDROJ PRAVDY) ──────────────────────────────
// Pořadí = pořadí v hlavním menu; rozcestník řadí podle tohoto pole taktéž.

export const NAV_ITEMS: NavItem[] = [
  // ── Hlavní menu (denní/týdenní) ──
  {
    href: '/dashboard',
    label: 'Přehled',
    icon: Icons.dashboard,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly', 'vychovatel'],
    primaryFor: ['director', 'vp', 'guide', 'assistant', 'readonly', 'vychovatel'],
    bottomNav: true,
  },
  {
    href: '/dashboard/dochazka',
    label: 'Docházka',
    icon: Icons.attendance,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    bottomNav: true,
  },
  {
    href: '/dashboard/tridni-kniha',
    label: 'Třídní kniha',
    icon: Icons.book,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    bottomNav: true,
  },
  {
    href: '/dashboard/muj-rozvrh',
    label: 'Můj rozvrh',
    icon: Icons.calendar,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: ['vp', 'guide', 'assistant', 'readonly'], // ředitel → Správa školy
    desc: 'Můj osobní týdenní rozvrh',
    tint: T.indigo,
    bottomNav: false,
  },
  {
    href: '/dashboard/zaci',
    label: 'Žáci',
    icon: Icons.students,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    bottomNav: false,
  },
  {
    href: '/dashboard/omluvenky',
    label: 'Omluvenky',
    icon: Icons.messages,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    bottomNav: true,
  },
  {
    href: '/dashboard/bulletin',
    label: 'Zprávy',
    icon: Icons.messages,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    bottomNav: false,
  },
  {
    href: '/dashboard/zivot/prispevky',
    label: 'Fotogalerie',
    icon: Icons.photo,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly', 'vychovatel'],
    primaryFor: ['director', 'vp', 'guide', 'assistant', 'readonly', 'vychovatel'],
    bottomNav: false,
  },
  {
    href: '/dashboard/druzina',
    label: 'Školní družina',
    icon: Icons.druzina,
    roles: ['director', 'vychovatel'],
    primaryFor: ['vychovatel'], // ředitel → Správa školy
    desc: 'Přihlášení a docházka družiny',
    tint: T.green,
    bottomNav: false,
  },
  // ── Ředitelské hlavní menu ──
  {
    href: '/dashboard/platby',
    label: 'Platby',
    icon: Icons.payments,
    roles: ['director'],
    primaryFor: ['director'],
    bottomNav: false,
  },
  {
    href: '/dashboard/spisovka',
    label: 'Spisovka',
    icon: Icons.archive,
    roles: ['director'],
    primaryFor: ['director'],
    bottomNav: false,
  },

  // ── Vstupní body rozcestníků (jsou to položky hlavního menu) ──
  {
    href: '/dashboard/dalsi',
    label: 'Další agendy',
    icon: Icons.more,
    roles: ['vp', 'guide', 'assistant', 'readonly', 'vychovatel'],
    primaryFor: ['vp', 'guide', 'assistant', 'readonly', 'vychovatel'],
    bottomNav: false,
  },
  {
    href: '/dashboard/sprava-skoly',
    label: 'Správa školy',
    icon: Icons.lock,
    roles: ['director'],
    primaryFor: ['director'],
    bottomNav: false,
  },

  // ── Nárazové agendy (overflow — primaryFor prázdné) ──
  {
    href: '/dashboard/mapa-pokroku',
    label: 'Mapa pokroku',
    icon: Icons.mapaPokroku,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: [],
    desc: 'Individuální plány a pokrok žáků',
    tint: T.green,
  },
  {
    href: '/dashboard/vp',
    label: 'VP',
    icon: Icons.vp,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: [],
    desc: 'Výchovně poradenské případy',
    tint: T.sky,
  },
  {
    href: '/dashboard/tripartita',
    label: 'Tripartity',
    icon: Icons.calendar,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly'],
    primaryFor: [],
    desc: 'Schůzky rodič–průvodce–žák',
    tint: T.cyan,
  },
  {
    href: '/dashboard/souhlasy',
    label: 'Souhlasy',
    icon: Icons.lock,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly', 'vychovatel'],
    primaryFor: [],
    desc: 'GDPR souhlasy zákonných zástupců',
    tint: T.emerald,
  },
  {
    href: '/dashboard/muj-profil',
    label: 'Můj profil',
    icon: Icons.students,
    roles: ['director', 'vp', 'guide', 'assistant', 'readonly', 'vychovatel'],
    primaryFor: [],
    desc: 'Osobní údaje a nastavení účtu',
    tint: T.stone,
  },
  {
    href: '/dashboard/uzavreni-pololeti',
    label: 'Uzavření pololetí',
    icon: Icons.attendance,
    roles: ['director', 'vp'], // odebráno guide, assistant
    primaryFor: [],
    desc: 'Kontrola a uzávěrka hodnocení',
    tint: T.blue,
  },
  {
    href: '/dashboard/bozp',
    label: 'BOZP',
    icon: Icons.lock,
    roles: ['director', 'vp'], // odebráno guide, assistant
    primaryFor: [],
    desc: 'Úrazy a bezpečnost práce',
    tint: T.amber,
  },
  {
    href: '/dashboard/nastaveni',
    label: 'Nastavení',
    icon: Icons.settings,
    roles: ['director'],
    primaryFor: [],
    desc: 'Systémová nastavení IS',
    tint: T.stone,
  },
  {
    href: '/dashboard/zapis',
    label: 'Zápis / Přestup',
    icon: Icons.clipboard,
    roles: ['director'],
    primaryFor: [],
    desc: 'Zápis a přestupy žáků',
    tint: T.fuchsia,
  },
  {
    href: '/dashboard/kontakty-rodicu',
    label: 'Kontakty rodičů',
    icon: Icons.phone,
    roles: ['director'],
    primaryFor: [],
    desc: 'Telefony zákonných zástupců po třídách — export do CSV',
    tint: T.sky,
  },
  {
    href: '/dashboard/rocniky',
    label: 'Ročníky žáků',
    icon: Icons.academicCap,
    roles: ['director'],
    primaryFor: [],
    desc: 'Povýšení a nastavení ročníku při přechodu na nový školní rok',
    tint: T.green,
  },
  // ── Director-only agendy, dříve JEN dlaždice ve Správě školy ──
  {
    href: '/dashboard/kalendar',
    label: 'Školní kalendář',
    icon: Icons.calendar,
    roles: ['director'],
    primaryFor: [],
    desc: 'Dny bez výuky — prázdniny, svátky, ředitelské volno',
    tint: T.teal,
  },
  {
    href: '/dashboard/rozvrh',
    label: 'Rozvrh',
    icon: Icons.rozvrhTemplate,
    roles: ['director'],
    primaryFor: [],
    desc: 'Stálá šablona rozvrhu a personální obsazení',
    tint: T.indigo,
  },
  {
    href: '/dashboard/nepritomnost',
    label: 'Nepřítomnost',
    icon: Icons.nepritomnost,
    roles: ['director'],
    primaryFor: [],
    desc: 'Evidence nemoci, OČR a volna zaměstnanců',
    tint: T.orange,
  },
  {
    href: '/dashboard/vykaz-ppc',
    label: 'Výkaz PPČ',
    icon: Icons.vykazPpc,
    roles: ['director'],
    primaryFor: [],
    desc: 'Přímá pedagogická činnost — podklad pro mzdy',
    tint: T.indigo,
  },
  {
    href: '/dashboard/sprava-skoly/discord',
    label: 'Discord ID',
    icon: Icons.discord,
    roles: ['director'],
    primaryFor: [],
    desc: 'Adresné připomínky nepotvrzených bloků rozvrhu',
    tint: T.slate,
  },
  {
    href: '/dashboard/obedy',
    label: 'Obědy — kdo jde na oběd',
    icon: Icons.lunch,
    roles: ['director', 'vp', 'guide', 'assistant', 'vychovatel'],
    primaryFor: [],
    desc: 'Denní přehled strávníků po třídách',
    tint: T.orange,
  },
  {
    href: '/dashboard/sprava-skoly/obedy',
    label: 'Obědy — nastavení SMS',
    icon: Icons.lunch,
    roles: ['director'],
    primaryFor: [],
    desc: 'Číslo jídelny a nastavení denní SMS s počty obědů',
    tint: T.orange,
  },
  {
    href: '/dashboard/msmt',
    label: 'MŠMT výkazy',
    icon: Icons.msmt,
    roles: ['director'],
    primaryFor: [],
    desc: 'Výkazy a statistická hlášení',
    tint: T.violet,
  },
  {
    href: '/dashboard/vykaz-ku',
    label: 'Měsíční výkaz pro KÚ',
    icon: Icons.vykazKu,
    roles: ['director'],
    primaryFor: [],
    desc: 'Počty žáků dle §, družina a obědy — měsíční přehled + CSV',
    tint: T.violet,
  },
  {
    href: '/dashboard/provoz-sluzeb',
    label: 'Provoz služeb',
    icon: Icons.server,
    roles: ['director'],
    primaryFor: [],
    desc: 'Kvóty a zdraví infrastruktury — Supabase, GitHub Actions',
    tint: T.cyan,
  },
  {
    href: '/dashboard/tridni-kniha/priznaky',
    label: 'Příznaky třídnice',
    icon: Icons.hospitace,
    roles: ['director'],
    primaryFor: [],
    desc: 'Přehled hospitací a příznaků bloků — filtr + CSV export',
    tint: T.amber,
  },
  {
    href: '/dashboard/zivot',
    label: 'Ze života školy',
    icon: Icons.photo,
    roles: ['director'],
    primaryFor: [],
    desc: 'Vydávání tokenů pro rodiče',
    tint: T.rose,
  },
]

// ── Odvození podle rolí ────────────────────────────────────────────────────

function has(list: AllRoles[], roleSet: string[]): boolean {
  return list.some((r) => roleSet.includes(r))
}

/**
 * Rozdělí položky podle role-setu uživatele (union staff.role ∪ extraRoles).
 *   main     → hlavní menu (sidebar / spodní lišta)
 *   overflow → nárazové agendy (rozcestník) — jen položky s dlaždicí (desc)
 */
// Demo: v read-only demu (NEXT_PUBLIC_DEMO_MODE) zpřístupní readonly inspektorovi
// kurátovaný seznam ředitelských modulů (data smí číst přes RLS, chybí jen menu).
// V produkci flag vypnutý = nulová změna.
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
const DEMO_READONLY_HREFS = new Set<string>(['/dashboard/platby', '/dashboard/druzina', '/dashboard/vykaz-ku', '/dashboard/rozvrh', '/dashboard/obedy'])

export function resolveNav(roleSet: string[]) {
  const demoUnlock = DEMO_MODE && roleSet.includes('readonly')
  const seen = (i: NavItem) => has(i.roles, roleSet) || (demoUnlock && DEMO_READONLY_HREFS.has(i.href))
  const primary = (i: NavItem) => has(i.primaryFor, roleSet) || (demoUnlock && DEMO_READONLY_HREFS.has(i.href))
  const visible = NAV_ITEMS.filter(seen)
  const main = visible.filter(primary)
  const overflow = visible.filter((i) => !primary(i) && i.desc)
  return { visible, main, overflow }
}

// ── Dlaždicová mřížka rozcestníku (sdílená serverovými stránkami) ──────────

export function NavTileGrid({ items }: { items: NavItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="group flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-sm dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600"
        >
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.tint ?? T.stone}`}>
            {t.icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1 font-medium text-gray-900 dark:text-stone-100">
              {t.label}
              <svg className="w-4 h-4 -translate-x-1 text-gray-400 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
            {t.desc && <p className="mt-0.5 text-sm text-gray-500 dark:text-stone-400">{t.desc}</p>}
          </div>
        </Link>
      ))}
    </div>
  )
}
