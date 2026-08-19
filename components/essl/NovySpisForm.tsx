'use client'

/**
 * components/essl/NovySpisForm.tsx
 *
 * Formulář pro založení nového spisu.
 * Spisová značka se generuje DB triggerem (trg_essl_sz_spis).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { KOD_AGENDY_OPTIONS } from '@/lib/essl/types'
import { esslLog } from '@/lib/essl/esslLog'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 ' +
  'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 ' +
  'placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500'

const selectCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 ' +
  'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500'

function Field({ label, required, hint, children }: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{hint}</p>}
    </div>
  )
}

export default function NovySpisForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Neblokující upozornění, pokud spis vznikne, ale audit selže (§91).
  const [auditWarning, setAuditWarning] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const [nazev, setNazev] = useState('')
  const [kodAgendy, setKodAgendy] = useState('')
  const [datumOtevreni, setDatumOtevreni] = useState(todayIso())
  const [poznamka, setPoznamka] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleSubmit() {
    setError(null)
    setAuditWarning(null)

    if (!nazev.trim()) {
      setError('Název spisu je povinný.')
      return
    }
    if (!kodAgendy) {
      setError('Kód agendy je povinný.')
      return
    }

    const { data, error: insertError } = await supabase
      .from('spisy')
      .insert({
        nazev:          nazev.trim(),
        kod_agendy:     kodAgendy,
        datum_otevreni: datumOtevreni,
        stav:           'otevreny',
        poznamka:       poznamka.trim() || null,
      })
      .select('id, spisova_znacka')
      .single()

    if (insertError) {
      setError(insertError.message)
      return
    }

    // Audit log
    const { error: auditError } = await esslLog(supabase, {
      p_operace:  'spis_zalozen',
      p_spis_id:  data.id,
      p_detail:   { spisova_znacka: data.spisova_znacka },
    })

    if (auditError) {
      // Neblokující: spis je vytvořen, ale auditní stopa selhala.
      // Nenavigujeme automaticky, jinak by se banner navigací ztratil.
      setAuditWarning(
        `Spis ${data.spisova_znacka} byl založen, ale auditní záznam se nezapsal: ` +
          `${auditError.message}. Kontaktujte správce.`,
      )
      setCreatedId(data.id)
      return
    }

    startTransition(() => {
      router.push(`/dashboard/spisovka/spisy/${data.id}`)
    })
  }

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl p-6 space-y-5">

      {/* Název */}
      <Field label="Název spisu" required>
        <input
          type="text"
          value={nazev}
          onChange={e => setNazev(e.target.value)}
          placeholder="Stručný název agendy nebo případu"
          className={inputCls}
          autoFocus
        />
      </Field>

      {/* Kód agendy */}
      <Field
        label="Kód agendy"
        required
        hint="Určuje prefix spisové značky (např. VIL-SR/1/2026)."
      >
        <select
          value={kodAgendy}
          onChange={e => setKodAgendy(e.target.value)}
          className={selectCls}
        >
          <option value="">— vyberte agendu —</option>
          {KOD_AGENDY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Field>

      {/* Datum otevření */}
      <Field label="Datum otevření" required>
        <input
          type="date"
          value={datumOtevreni}
          onChange={e => setDatumOtevreni(e.target.value)}
          className={inputCls}
        />
      </Field>

      {/* Poznámka */}
      <Field label="Poznámka">
        <textarea
          value={poznamka}
          onChange={e => setPoznamka(e.target.value)}
          rows={2}
          placeholder="Interní poznámka…"
          className={`${inputCls} resize-none`}
        />
      </Field>

      {/* Chyba */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      {/* Neblokující upozornění — audit selhal, spis vznikl (§91) */}
      {auditWarning && (
        <div className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg space-y-2">
          <p>⚠️ {auditWarning}</p>
          {createdId && (
            <Link
              href={`/dashboard/spisovka/spisy/${createdId}`}
              className="inline-block font-medium underline underline-offset-2"
            >
              Pokračovat na detail spisu →
            </Link>
          )}
        </div>
      )}

      {/* Akce */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-stone-100 dark:border-stone-800">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-sm text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
        >
          Zrušit
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="px-5 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {isPending ? 'Ukládám…' : 'Založit spis'}
        </button>
      </div>
    </div>
  )
}
