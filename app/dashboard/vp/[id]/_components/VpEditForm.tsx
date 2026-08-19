'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateVpCare, closeVpCare } from '@/app/actions/vp'
import { TYP_PECE_LABEL } from '@/lib/vp-shared'
import type { TypVpPece, VpStudentCare } from '@/lib/vp-shared'

interface Props {
  care:    VpStudentCare
  canEdit: boolean
}

export function VpEditForm({ care, canEdit }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [typPece,       setTypPece]       = useState<TypVpPece>(care.typ_pece)
  const [spzValidUntil, setSpzValidUntil] = useState(care.spz_valid_until ?? '')
  const [spzReviewDue,  setSpzReviewDue]  = useState(care.spz_review_due  ?? '')
  const [ivpRequired,   setIvpRequired]   = useState(care.ivp_required)
  const [ivpEvaluatedAt, setIvpEvaluatedAt] = useState(care.ivp_evaluated_at ?? '')
  const [drivePublic,   setDrivePublic]   = useState(care.drive_url_public  ?? '')
  const [drivePrivate,  setDrivePrivate]  = useState(care.drive_url_private ?? '')
  const [poznamka,      setPoznamka]      = useState(care.poznamka ?? '')
  const [saved,         setSaved]         = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  // Pouze director/vp vidí a editují drive_url_private
  const showPrivate = care.drive_url_private !== null

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateVpCare(care.id, {
        typ_pece:          typPece,
        spz_valid_until:   spzValidUntil  || null,
        spz_review_due:    spzReviewDue   || null,
        ivp_required:      ivpRequired,
        ivp_evaluated_at:  ivpEvaluatedAt || null,
        drive_url_public:  drivePublic    || null,
        drive_url_private: showPrivate ? (drivePrivate || null) : undefined,
        poznamka:          poznamka       || null,
      })
      if (result.success) {
        setSaved(true)
        router.refresh()
      } else {
        setError(
          result.error?.includes('check_vp_review')
            ? 'Datum přezkoumání ŠPZ nesmí být pozdější než datum platnosti ŠPZ.'
            : result.error
        )
      }
    })
  }

  function handleClose(status: 'closed' | 'transferred') {
    if (!confirm(`Opravdu chcete záznam označit jako „${status === 'closed' ? 'uzavřen' : 'přeřazen'}"?`)) return
    startTransition(async () => {
      const result = await closeVpCare(care.id, status)
      if (result.success) router.refresh()
      else setError(result.error)
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-5">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
        Základní informace
      </h2>

      {/* Typ péče */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700">Typ péče</label>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {(Object.entries(TYP_PECE_LABEL) as [TypVpPece, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTypPece(key)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  typPece === key
                    ? 'border-orange-500 bg-orange-500 text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-700">{TYP_PECE_LABEL[care.typ_pece]}</p>
        )}
      </div>

      {/* Lhůty */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            Platnost doporučení ŠPZ
          </label>
          {canEdit ? (
            <input
              type="date"
              value={spzValidUntil}
              onChange={e => setSpzValidUntil(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          ) : (
            <p className="text-sm text-gray-700">
              {care.spz_valid_until
                ? new Date(care.spz_valid_until).toLocaleDateString('cs-CZ')
                : '—'}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            Termín přehodnocení ŠPZ
          </label>
          {canEdit ? (
            <input
              type="date"
              value={spzReviewDue}
              onChange={e => setSpzReviewDue(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          ) : (
            <p className="text-sm text-gray-700">
              {care.spz_review_due
                ? new Date(care.spz_review_due).toLocaleDateString('cs-CZ')
                : '—'}
            </p>
          )}
        </div>
      </div>

      {/* IVP */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          {canEdit ? (
            <>
              <input
                type="checkbox"
                id="ivp_required_edit"
                checked={ivpRequired}
                onChange={e => setIvpRequired(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
              />
              <label htmlFor="ivp_required_edit" className="text-sm text-gray-700">
                IVP je požadováno
              </label>
            </>
          ) : (
            <p className="text-sm text-gray-700">
              IVP: {care.ivp_required ? 'Ano' : 'Ne'}
            </p>
          )}
        </div>
        {ivpRequired && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Datum posledního hodnocení IVP
            </label>
            {canEdit ? (
              <input
                type="date"
                value={ivpEvaluatedAt}
                onChange={e => setIvpEvaluatedAt(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            ) : (
              <p className="text-sm text-gray-700">
                {care.ivp_evaluated_at
                  ? new Date(care.ivp_evaluated_at).toLocaleDateString('cs-CZ')
                  : '—'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Drive URL */}
      {canEdit && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Drive — veřejná složka
            </label>
            <input
              type="url"
              value={drivePublic}
              onChange={e => setDrivePublic(e.target.value)}
              placeholder="https://drive.google.com/…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </div>
          {showPrivate && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                Drive — citlivá složka
                <span className="ml-1.5 text-xs text-gray-400">(vidí pouze VP a ředitel)</span>
              </label>
              <input
                type="url"
                value={drivePrivate}
                onChange={e => setDrivePrivate(e.target.value)}
                placeholder="https://drive.google.com/…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            </div>
          )}
        </div>
      )}

      {/* Poznámka */}
      {canEdit && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Poznámka</label>
          <textarea
            value={poznamka}
            onChange={e => setPoznamka(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none"
          />
        </div>
      )}

      {/* Feedback */}
      {saved && (
        <p className="text-sm text-green-600">✓ Uloženo</p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Akce */}
      {canEdit && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex gap-2">
            {care.status === 'active' && (
              <>
                <button
                  type="button"
                  onClick={() => handleClose('closed')}
                  disabled={isPending}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Uzavřít
                </button>
                <button
                  type="button"
                  onClick={() => handleClose('transferred')}
                  disabled={isPending}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Přeřazen
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Ukládám…' : 'Uložit změny'}
          </button>
        </div>
      )}
    </div>
  )
}
