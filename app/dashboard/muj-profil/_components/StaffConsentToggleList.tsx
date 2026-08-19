'use client'

/**
 * app/dashboard/muj-profil/_components/StaffConsentToggleList.tsx
 * Client Component — trojpolový přepínač souhlasů zaměstnance (self).
 *
 * Stejná logika jako rodičovský přepínač, ale jeden subjekt (žádný výběr osoby).
 * „Neuděleno" je jen výchozí stav, nelze ho zvolit zpět (set_staff_consent
 * přijímá jen granted/denied). Gray paleta (dashboard, vzor VP).
 */

import { useState, useTransition } from 'react'
import { setStaffConsentAction } from '@/app/actions/staff-consents'
import type { StaffConsentRow } from '@/lib/staff-consents'
import type { ConsentStatus } from '@/lib/consents'

export default function StaffConsentToggleList({ rows }: { rows: StaffConsentRow[] }) {
  const [data, setData] = useState<StaffConsentRow[]>(rows)
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleSet(row: StaffConsentRow, status: ConsentStatus) {
    if (row.my_status === status) return
    setError(null)
    setPendingCode(row.code)

    const snapshot = data
    setData((cur) =>
      cur.map((r) =>
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
    )

    startTransition(async () => {
      const res = await setStaffConsentAction(row.definition_id, status)
      if (!res.success) {
        setData(snapshot)
        setError(res.error)
      }
      setPendingCode(null)
    })
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">
        Žádné souhlasy k vyjádření.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {data.map((row) => (
        <div key={row.code} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">{row.title}</p>
            {row.special_category && <SpecialBadge />}
          </div>

          <p className="text-sm text-gray-500">{row.body}</p>

          {row.needs_reconsent && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-amber-800">
                Znění souhlasu bylo aktualizováno. Vaše dosavadní vyjádření platí, dokud se
                nevyjádříte k nové verzi.
              </p>
            </div>
          )}

          <SegmentedConsent
            current={row.my_status}
            pending={pendingCode === row.code}
            onPick={(s) => handleSet(row, s)}
          />

          {row.my_status && row.my_decided_at && (
            <p className="text-xs text-gray-400">Naposledy uloženo {fmtDate(row.my_decided_at)}</p>
          )}
        </div>
      ))}
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
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
      <Seg label="Nesouhlasím" active={current === 'denied'} activeClass="text-red-600" onClick={() => onPick('denied')} disabled={pending} />
      <Seg label="Neuděleno" active={current === null} activeClass="text-gray-500" onClick={undefined} disabled />
      <Seg label="Souhlasím" active={current === 'granted'} activeClass="text-green-600" onClick={() => onPick('granted')} disabled={pending} />
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
        'rounded-md px-2 py-2 text-xs sm:text-sm font-medium transition-colors text-center',
        active ? `bg-white shadow-sm ${activeClass}` : 'text-gray-500',
        interactive ? 'hover:text-gray-700' : '',
        !interactive && !active ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function SpecialBadge() {
  return (
    <span className="inline-flex items-center gap-1 mt-1.5 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      Zvláštní kategorie údajů
    </span>
  )
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}
