'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateVpCare } from '@/app/actions/vp'
import {
  DOKUMENT_KEYS,
  DOKUMENT_META,
  defaultDokumentItem,
} from '@/lib/vp-shared'
import type { DokumentKey, DokumentyMap, DokumentItem } from '@/lib/vp-shared'

interface Props {
  careId:    string
  dokumenty: DokumentyMap
  canEdit:   boolean
}

export function DokumentyChecklist({ careId, dokumenty, canEdit }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [local, setLocal] = useState<DokumentyMap>(dokumenty)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  function getItem(key: DokumentKey): DokumentItem {
    return local[key] ?? defaultDokumentItem(key)
  }

  function updateItem(key: DokumentKey, patch: Partial<DokumentItem>) {
    setLocal(prev => ({
      ...prev,
      [key]: { ...getItem(key), ...patch },
    }))
    setSaved(false)
  }

  function toggleExists(key: DokumentKey) {
    const current = getItem(key)
    if (!current.exists) {
      // Zapínáme — nastavíme defaultní in_private
      updateItem(key, {
        exists:     true,
        in_private: DOKUMENT_META[key].default_private,
      })
    } else {
      // Vypínáme — vymažeme lhůtu
      updateItem(key, { exists: false, valid_until: null })
    }
  }

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateVpCare(careId, { dokumenty: local })
      if (result.success) {
        setSaved(true)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Dokumenty
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-lg bg-orange-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Ukládám…' : 'Uložit'}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {DOKUMENT_KEYS.map(key => {
          const meta = DOKUMENT_META[key]
          const item = getItem(key)

          return (
            <div
              key={key}
              className={`rounded-lg border p-3 transition-colors ${
                item.exists
                  ? 'border-orange-200 bg-orange-50'
                  : 'border-gray-100 bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox exists */}
                <div className="pt-0.5">
                  {canEdit ? (
                    <input
                      type="checkbox"
                      checked={item.exists}
                      onChange={() => toggleExists(key)}
                      className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
                    />
                  ) : (
                    <span className={`block h-4 w-4 rounded border-2 ${
                      item.exists
                        ? 'border-orange-500 bg-orange-500'
                        : 'border-gray-300 bg-white'
                    }`} />
                  )}
                </div>

                <div className="flex-1 space-y-2">
                  {/* Label */}
                  <p className={`text-sm font-medium ${
                    item.exists ? 'text-orange-900' : 'text-gray-500'
                  }`}>
                    {meta.label}
                  </p>

                  {/* Rozšířené pole — jen pokud exists */}
                  {item.exists && (
                    <div className="flex flex-wrap items-center gap-3">

                      {/* Lhůta platnosti */}
                      {meta.has_expiry && (
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs text-gray-500">Platnost do:</label>
                          {canEdit ? (
                            <input
                              type="date"
                              value={item.valid_until ?? ''}
                              onChange={e => updateItem(key, { valid_until: e.target.value || null })}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs focus:border-orange-400 focus:outline-none"
                            />
                          ) : (
                            <span className="text-xs text-gray-700">
                              {item.valid_until
                                ? new Date(item.valid_until).toLocaleDateString('cs-CZ')
                                : '—'}
                            </span>
                          )}
                        </div>
                      )}

                      {/* in_private toggle */}
                      <div className="flex items-center gap-1.5">
                        {canEdit ? (
                          <>
                            <input
                              type="checkbox"
                              id={`priv-${key}`}
                              checked={item.in_private}
                              onChange={e => updateItem(key, { in_private: e.target.checked })}
                              className="h-3.5 w-3.5 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
                            />
                            <label htmlFor={`priv-${key}`} className="text-xs text-gray-500">
                              Citlivá složka
                            </label>
                          </>
                        ) : item.in_private ? (
                          <span className="text-xs text-gray-400">Citlivá složka</span>
                        ) : null}
                      </div>

                      {/* Poznámka pro "jine" */}
                      {key === 'jine' && canEdit && (
                        <input
                          type="text"
                          value={(item as any).poznamka ?? ''}
                          onChange={e => updateItem(key, { poznamka: e.target.value || null } as any)}
                          placeholder="Popis dokumentu…"
                          className="flex-1 rounded border border-gray-300 px-2 py-0.5 text-xs focus:border-orange-400 focus:outline-none"
                        />
                      )}
                      {key === 'jine' && !canEdit && (item as any).poznamka && (
                        <span className="text-xs text-gray-600">{(item as any).poznamka}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {saved && (
        <p className="text-sm text-green-600">✓ Dokumenty uloženy</p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  )
}
