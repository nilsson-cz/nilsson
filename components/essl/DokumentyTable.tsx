'use client'

/**
 * components/essl/DokumentyTable.tsx
 *
 * Client Component — filtry + tabulka dokumentů.
 * Filtry mění URL (useRouter + searchParams) → Server Component se re-renderuje.
 *
 * Props jsou serializovatelné (plain objects z page.tsx).
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import Link from 'next/link'
import type { DokumentRow, VecnaSkupina } from '@/lib/essl/types'
import type { DokumentyFilters } from '@/lib/essl/queries'
import {
  STAV_LABELS,
  SMER_LABELS,
  SKARTACNI_ZNAK_LABELS,
} from '@/lib/essl/types'

// ── Badge komponenty ──────────────────────────────────────────────────────

function StavBadge({ stav }: { stav: DokumentRow['stav'] }) {
  const styles: Record<string, string> = {
    prijat:      'bg-blue-50   dark:bg-blue-950  text-blue-700   dark:text-blue-300',
    prideleno:   'bg-amber-50  dark:bg-amber-950 text-amber-700  dark:text-amber-300',
    ve_vyrizeni: 'bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300',
    vyrizeno:    'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
    uzavreno:    'bg-stone-100 dark:bg-stone-800 text-stone-500  dark:text-stone-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${styles[stav] ?? ''}`}>
      {STAV_LABELS[stav] ?? stav}
    </span>
  )
}

function SmerBadge({ smer }: { smer: DokumentRow['smer'] }) {
  const styles: Record<string, string> = {
    prijaty: 'bg-sky-50   dark:bg-sky-950  text-sky-700   dark:text-sky-300',
    odchozi: 'bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300',
    vlastni: 'bg-stone-100 dark:bg-stone-800 text-stone-600  dark:text-stone-400',
  }
  const icons: Record<string, string> = {
    prijaty: '↓',
    odchozi: '↑',
    vlastni: '·',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${styles[smer] ?? ''}`}>
      <span>{icons[smer]}</span>
      {SMER_LABELS[smer] ?? smer}
    </span>
  )
}

function SkartacniZnakBadge({ znak }: { znak: string | null }) {
  if (!znak) return <span className="text-stone-300 dark:text-stone-600">—</span>
  const styles: Record<string, string> = {
    A: 'bg-red-50   dark:bg-red-950  text-red-700   dark:text-red-300  border border-red-200   dark:border-red-800',
    S: 'bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-700',
    V: 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
  }
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${styles[znak] ?? ''}`}
      title={SKARTACNI_ZNAK_LABELS[znak as keyof typeof SKARTACNI_ZNAK_LABELS]}
    >
      {znak}
    </span>
  )
}

// ── Pomocné funkce ────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

// Sestaví věcné skupiny úrovně 1+2 jako grouped options pro <select>
function buildVsOptions(vecneSkupiny: VecnaSkupina[]) {
  const skupiny = vecneSkupiny.filter(vs => vs.uroven === 1)
  return skupiny.map(sk => ({
    label: `${sk.spis_znak} ${sk.nazev}`,
    options: vecneSkupiny
      .filter(vs => vs.uroven === 2 && vs.nadrazeny_znak === sk.spis_znak)
      .map(pod => ({
        value: pod.id,
        label: `${pod.spis_znak} ${pod.nazev}`,
      })),
  }))
}

// ── Props ─────────────────────────────────────────────────────────────────

type Props = {
  dokumenty: DokumentRow[]
  vecneSkupiny: VecnaSkupina[]
  dostupneRoky: number[]
  activeFilters: DokumentyFilters
}

// ── Komponenta ────────────────────────────────────────────────────────────

export default function DokumentyTable({ dokumenty, vecneSkupiny, dostupneRoky, activeFilters }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const vsOptions = buildVsOptions(vecneSkupiny)

  // Aktualizuje jeden filtr v URL (ostatní zachová)
  const setFilter = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`)
    })
  }, [router, pathname, searchParams])

  const clearFilters = useCallback(() => {
    startTransition(() => {
      router.replace(pathname)
    })
  }, [router, pathname])

  const hasActiveFilters = !!(
    activeFilters.rok ||
    activeFilters.stav ||
    activeFilters.smer ||
    activeFilters.vecna_skupina_id ||
    activeFilters.q
  )

  return (
    <div className={isPending ? 'opacity-60 pointer-events-none transition-opacity' : ''}>

      {/* ── Filtry ──────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">

          {/* Fulltext */}
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
              Hledat v předmětu
            </label>
            <input
              type="search"
              defaultValue={activeFilters.q ?? ''}
              placeholder="Výzva, inspekce…"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setFilter('q', (e.target as HTMLInputElement).value)
                }
              }}
              onBlur={e => setFilter('q', e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Rok */}
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
              Rok
            </label>
            <select
              value={activeFilters.rok?.toString() ?? ''}
              onChange={e => setFilter('rok', e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Všechny roky</option>
              {dostupneRoky.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Směr */}
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
              Směr
            </label>
            <select
              value={activeFilters.smer ?? ''}
              onChange={e => setFilter('smer', e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Vše</option>
              <option value="prijaty">↓ Přijatý</option>
              <option value="odchozi">↑ Odchozí</option>
              <option value="vlastni">· Vlastní</option>
            </select>
          </div>

          {/* Stav */}
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
              Stav
            </label>
            <select
              value={activeFilters.stav ?? ''}
              onChange={e => setFilter('stav', e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Všechny stavy</option>
              {Object.entries(STAV_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {/* Věcná skupina */}
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
              Věcná skupina
            </label>
            <select
              value={activeFilters.vecna_skupina_id ?? ''}
              onChange={e => setFilter('vs', e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 max-w-56"
            >
              <option value="">Všechny skupiny</option>
              {vsOptions.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Reset filtrů */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 border border-stone-200 dark:border-stone-700 rounded-lg transition-colors"
            >
              Zrušit filtry
            </button>
          )}
        </div>
      </div>

      {/* ── Tabulka ─────────────────────────────────────────────────────── */}
      {dokumenty.length === 0 ? (
        <div className="text-center py-16 text-stone-400 dark:text-stone-600">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          <p className="text-sm">Žádné dokumenty neodpovídají filtrům</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 dark:border-stone-800">
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Č.j.</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">Předmět</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Věcná skupina</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">Směr</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">Stav</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Datum</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400">Sk.</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap">Istění</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                {dokumenty.map((dok) => (
                  <tr
                    key={dok.id}
                    className="hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
                  >
                    {/* Č.j. */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-mono text-xs text-stone-600 dark:text-stone-400">
                        {dok.cislo_jednaci}
                      </span>
                      {dok.ds_zprava_id && (
                        <span className="ml-1.5 text-[10px] text-sky-500 dark:text-sky-400" title={`DS zpráva #${dok.ds_zprava_id}`}>DS</span>
                      )}
                    </td>

                    {/* Předmět */}
                    <td className="px-4 py-3 max-w-xs">
                      <span className="line-clamp-2 text-stone-800 dark:text-stone-200">
                        {dok.predmet}
                      </span>
                      {dok.subjekt_nazev_cache && (
                        <span className="block text-xs text-stone-400 dark:text-stone-500 truncate mt-0.5">
                          {dok.subjekt_nazev_cache}
                        </span>
                      )}
                    </td>

                    {/* Věcná skupina */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {dok.vecna_skupina ? (
                        <span className="text-xs text-stone-500 dark:text-stone-400">
                          <span className="font-mono">{dok.vecna_skupina.spis_znak}</span>
                          <span className="ml-1.5 text-stone-400 dark:text-stone-500 hidden xl:inline">
                            {dok.vecna_skupina.nazev}
                          </span>
                        </span>
                      ) : (
                        <span className="text-stone-300 dark:text-stone-600 text-xs">—</span>
                      )}
                    </td>

                    {/* Směr */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <SmerBadge smer={dok.smer} />
                    </td>

                    {/* Stav */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StavBadge stav={dok.stav} />
                    </td>

                    {/* Datum */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                      {formatDate(dok.datum_prijeti ?? dok.datum_vzniku)}
                    </td>

                    {/* Skartační znak */}
                    <td className="px-4 py-3">
                      <SkartacniZnakBadge znak={dok.skartacni_znak} />
                    </td>

                    {/* Datum istění */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                      {formatDate(dok.datum_isteni)}
                    </td>

                    {/* Akce */}
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/spisovka/${dok.id}`}
                        className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
                      >
                        Detail →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer — počet */}
          <div className="border-t border-stone-100 dark:border-stone-800 px-4 py-2.5 text-xs text-stone-400 dark:text-stone-500">
            {dokumenty.length} dokumentů
            {hasActiveFilters && ' (filtrováno)'}
          </div>
        </div>
      )}
    </div>
  )
}
