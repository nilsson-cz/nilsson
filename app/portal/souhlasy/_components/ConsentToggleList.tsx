'use client'

/**
 * app/portal/souhlasy/_components/ConsentToggleList.tsx
 * Client Component — trojpolový přepínač souhlasů pro rodiče.
 *
 * - Výběr dítěte (pokud má rodič víc dětí).
 * - Pro každý aktivní účel: trojpolový přepínač Nesouhlasím / Neuděleno / Souhlasím.
 *   „Neuděleno" je jen výchozí stav (žádný záznam) — nelze ho zvolit zpět,
 *   set_consent přijímá pouze granted/denied. Po prvním vyjádření se proto
 *   segment Neuděleno deaktivuje.
 * - Optimistický zápis; při chybě se stav vrátí a zobrazí hláška.
 * - special_category účel je vizuálně odlišen; needs_reconsent ukazuje výzvu.
 */

import { useState, useTransition } from 'react'
import { setConsentAction } from '@/app/actions/portal-consents'
import type { GuardianConsentRow, ConsentStatus } from '@/lib/consents'

type ChildConsents = {
  id: string
  first_name: string
  last_name: string
  consents: GuardianConsentRow[]
}

export default function ConsentToggleList({
  childrenData,
}: {
  childrenData: ChildConsents[]
}) {
  const [data, setData] = useState<ChildConsents[]>(childrenData)
  const [selectedChildId, setSelectedChildId] = useState<string>(childrenData[0]?.id ?? '')
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const selectedChild = data.find((c) => c.id === selectedChildId) ?? data[0]

  function handleSet(childId: string, row: GuardianConsentRow, status: ConsentStatus) {
    if (row.my_status === status) return
    setError(null)
    const key = `${childId}:${row.code}`
    setPendingKey(key)

    const snapshot = data
    // optimistický zápis
    setData((cur) =>
      cur.map((c) =>
        c.id !== childId
          ? c
          : {
              ...c,
              consents: c.consents.map((r) =>
                r.code !== row.code
                  ? r
                  : {
                      ...r,
                      my_status: status,
                      responded_version: r.active_version,
                      my_decided_at: new Date().toISOString(),
                      needs_reconsent: false,
                    },
              ),
            },
      ),
    )

    startTransition(async () => {
      const res = await setConsentAction(row.definition_id, childId, status)
      if (!res.success) {
        setData(snapshot) // revert
        setError(res.error)
      }
      setPendingKey(null)
    })
  }

  return (
    <div className="space-y-4">
      {/* Globální chybová hláška */}
      {error && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 px-4 py-3">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Výběr dítěte — jen pokud > 1 */}
      {data.length > 1 && (
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
            Pro které dítě?
          </label>
          <div className="space-y-2">
            {data.map((child) => {
              const undecided = child.consents.filter((r) => r.my_status === null).length
              const isSelected = child.id === selectedChildId
              return (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => { setSelectedChildId(child.id); setError(null) }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-colors ${
                    isSelected
                      ? 'border-orange-400 dark:border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 font-medium'
                      : 'border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:border-stone-300 dark:hover:border-stone-600'
                  }`}
                >
                  <span>{child.first_name} {child.last_name}</span>
                  {undecided > 0 && (
                    <span className="text-xs text-orange-500 dark:text-orange-400">
                      {undecided} k vyřízení
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Seznam účelů pro vybrané dítě */}
      {selectedChild && (
        <div className="space-y-3">
          {selectedChild.consents.map((row) => {
            const key = `${selectedChild.id}:${row.code}`
            return (
              <div
                key={row.code}
                className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-5 space-y-3"
              >
                <div>
                  <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {row.title}
                  </p>
                  {row.special_category && <SpecialBadge />}
                </div>

                <p className="text-sm text-stone-500 dark:text-stone-400">{row.body}</p>

                {row.needs_reconsent && (
                  <div className="flex items-start gap-2 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-100 dark:border-orange-900 px-3 py-2">
                    <svg className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-orange-700 dark:text-orange-300">
                      Znění souhlasu bylo aktualizováno. Vaše dosavadní vyjádření zůstává
                      platné, dokud se nevyjádříte k nové verzi.
                    </p>
                  </div>
                )}

                <SegmentedConsent
                  current={row.my_status}
                  pending={pendingKey === key}
                  onPick={(s) => handleSet(selectedChild.id, row, s)}
                />

                {row.my_status && row.my_decided_at && (
                  <p className="text-xs text-stone-400 dark:text-stone-500">
                    Naposledy uloženo {fmtDate(row.my_decided_at)}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Trojpolový přepínač ───────────────────────────────────────────────────────

function SegmentedConsent({
  current,
  pending,
  onPick,
}: {
  current: ConsentStatus | null
  pending: boolean
  onPick: (status: ConsentStatus) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 dark:bg-stone-800 p-1">
      <Seg
        label="Nesouhlasím"
        active={current === 'denied'}
        activeClass="text-red-600 dark:text-red-400"
        onClick={() => onPick('denied')}
        disabled={pending}
      />
      <Seg
        label="Neuděleno"
        active={current === null}
        activeClass="text-stone-500 dark:text-stone-300"
        /* Neuděleno nelze zvolit — je to jen výchozí stav před prvním vyjádřením */
        onClick={undefined}
        disabled
      />
      <Seg
        label="Souhlasím"
        active={current === 'granted'}
        activeClass="text-emerald-600 dark:text-emerald-400"
        onClick={() => onPick('granted')}
        disabled={pending}
      />
    </div>
  )
}

function Seg({
  label,
  active,
  activeClass,
  onClick,
  disabled,
}: {
  label: string
  active: boolean
  activeClass: string
  onClick?: () => void
  disabled?: boolean
}) {
  const interactive = !!onClick && !disabled
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-pressed={active}
      className={[
        'rounded-lg px-2 py-2 text-xs sm:text-sm font-medium transition-colors text-center',
        active
          ? `bg-white dark:bg-stone-900 shadow-sm ${activeClass}`
          : 'text-stone-500 dark:text-stone-400',
        interactive ? 'hover:text-stone-700 dark:hover:text-stone-200' : '',
        !interactive && !active ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

// ── Pomocné ───────────────────────────────────────────────────────────────────

function SpecialBadge() {
  return (
    <span className="inline-flex items-center gap-1 mt-1.5 rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs text-stone-500 dark:text-stone-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      Zvláštní kategorie údajů
    </span>
  )
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  })
}
