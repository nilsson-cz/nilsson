'use client'

/**
 * components/essl/NovyDokumentForm.tsx
 *
 * Client Component — formulář pro ruční evidenci nového dokumentu.
 * Po úspěšném INSERT přesměruje na detail dokumentu.
 *
 * Číslo jednací generuje DB trigger (trg_essl_cj_dok) automaticky.
 * Skartační znak + lhůta se přeberou z věcné skupiny přes DB trigger.
 */

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import type { VecnaSkupina, JmennyRejstrikItem, DokumentSmer, ZpusobDoruceni } from '@/lib/essl/types'
import { ZPUSOB_DORUCENI_LABELS } from '@/lib/essl/types'
import { esslLog } from '@/lib/essl/esslLog'

// ── Helpers ───────────────────────────────────────────────────────────────

function buildVsOptions(vecneSkupiny: VecnaSkupina[]) {
  const skupiny = vecneSkupiny.filter(vs => vs.uroven === 1)
  return skupiny.map(sk => ({
    label: `${sk.spis_znak} ${sk.nazev}`,
    options: vecneSkupiny
      .filter(vs => vs.nadrazeny_znak === sk.spis_znak && vs.uroven === 2)
      .flatMap(pod => [
        { value: pod.id, label: `${pod.spis_znak} ${pod.nazev}` },
        ...vecneSkupiny
          .filter(vs => vs.nadrazeny_znak === pod.spis_znak && vs.uroven === 3)
          .map(detail => ({ value: detail.id, label: `  ${detail.spis_znak} ${detail.nazev}` })),
      ]),
  }))
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Field wrapper ─────────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
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

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 ' +
  'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 ' +
  'placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500'

const selectCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 ' +
  'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500'

// ── Props ─────────────────────────────────────────────────────────────────

type Props = {
  vecneSkupiny: VecnaSkupina[]
  jmennyRejstrik: JmennyRejstrikItem[]
}

// ── Komponenta ────────────────────────────────────────────────────────────

export default function NovyDokumentForm({ vecneSkupiny, jmennyRejstrik }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Neblokující upozornění, pokud dokument vznikne, ale audit selže (§91).
  const [auditWarning, setAuditWarning] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  // Pole formuláře
  const [predmet, setPredmet] = useState('')
  const [smer, setSmer] = useState<DokumentSmer>('prijaty')
  const [zpusobDoruceni, setZpusobDoruceni] = useState<ZpusobDoruceni | ''>('datova_schranka')
  const [datumPrijeti, setDatumPrijeti] = useState(todayIso())
  const [datumVzniku, setDatumVzniku] = useState(todayIso())
  const [vecnaSkupinaId, setVecnaSkupinaId] = useState('')
  const [subjektId, setSubjektId] = useState('')
  const [subjektNazevCache, setSubjektNazevCache] = useState('')
  const [dsZpravaId, setDsZpravaId] = useState('')
  const [poznamka, setPoznamka] = useState('')

  const vsOptions = buildVsOptions(vecneSkupiny)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Při výběru subjektu z rejstříku doplníme cache název
  function handleSubjektChange(id: string) {
    setSubjektId(id)
    const subjekt = jmennyRejstrik.find(s => s.id === id)
    setSubjektNazevCache(subjekt?.nazev ?? '')
  }

  async function handleSubmit() {
    setError(null)
    setAuditWarning(null)

    if (!predmet.trim()) {
      setError('Předmět dokumentu je povinný.')
      return
    }
    if (!vecnaSkupinaId) {
      setError('Věcná skupina je povinná.')
      return
    }

    // datum_zahajeni_lhuty = 1. 1. následujícího roku po vzniku
    const rokVzniku = new Date(datumVzniku).getFullYear()
    const datumZahajeniLhuty = `${rokVzniku + 1}-01-01`

    const payload: Record<string, unknown> = {
      predmet:              predmet.trim(),
      smer,
      zpusob_doruceni:      zpusobDoruceni || null,
      datum_prijeti:        smer === 'prijaty' ? datumPrijeti : null,
      datum_vzniku:         datumVzniku,
      vecna_skupina_id:     vecnaSkupinaId,
      subjekt_id:           subjektId || null,
      subjekt_nazev_cache:  subjektNazevCache || null,
      ds_zprava_id:         dsZpravaId ? Number(dsZpravaId) : null,
      poznamka:             poznamka.trim() || null,
      stav:                 'prijat',
      datum_zahajeni_lhuty: datumZahajeniLhuty,
      prilohy:              [],
    }

    const { data, error: insertError } = await supabase
      .from('dokumenty')
      .insert(payload)
      .select('id, cislo_jednaci')
      .single()

    if (insertError) {
      setError(insertError.message)
      return
    }

    // Audit log — dokument_evidovan: ruční evidence nového dokumentu.
    const { error: auditError } = await esslLog(supabase, {
      p_operace:     'dokument_evidovan',
      p_dokument_id: data.id,
      p_detail:      { cislo_jednaci: data.cislo_jednaci, zpusob: 'rucni_evidence' },
    })

    if (auditError) {
      // Neblokující: dokument je vytvořen, ale auditní stopa selhala.
      // Nenavigujeme automaticky, jinak by se banner navigací ztratil —
      // uživatel pokračuje na detail ručně přes odkaz.
      setAuditWarning(
        `Dokument ${data.cislo_jednaci} byl vytvořen, ale auditní záznam se nezapsal: ` +
          `${auditError.message}. Kontaktujte správce.`,
      )
      setCreatedId(data.id)
      return
    }

    startTransition(() => {
      router.push(`/dashboard/spisovka/${data.id}`)
    })
  }

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl p-6 space-y-5">

      {/* Předmět */}
      <Field label="Předmět dokumentu" required>
        <input
          type="text"
          value={predmet}
          onChange={e => setPredmet(e.target.value)}
          placeholder="Stručný popis obsahu dokumentu"
          className={inputCls}
          autoFocus
        />
      </Field>

      {/* Směr */}
      <Field label="Směr" required>
        <div className="flex gap-3">
          {(['prijaty', 'odchozi', 'vlastni'] as DokumentSmer[]).map(s => (
            <label
              key={s}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                smer === s
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-medium'
                  : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800'
              }`}
            >
              <input
                type="radio"
                name="smer"
                value={s}
                checked={smer === s}
                onChange={() => setSmer(s)}
                className="sr-only"
              />
              {s === 'prijaty' ? '↓ Přijatý' : s === 'odchozi' ? '↑ Odchozí' : '· Vlastní'}
            </label>
          ))}
        </div>
      </Field>

      {/* Způsob doručení — skrytý pro vlastní */}
      {smer !== 'vlastni' && (
        <Field label="Způsob doručení">
          <select
            value={zpusobDoruceni}
            onChange={e => setZpusobDoruceni(e.target.value as ZpusobDoruceni)}
            className={selectCls}
          >
            <option value="">— nevybráno —</option>
            {(Object.entries(ZPUSOB_DORUCENI_LABELS) as [ZpusobDoruceni, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
      )}

      {/* Datum přijetí — jen pro přijatý */}
      {smer === 'prijaty' && (
        <Field label="Datum doručení" required>
          <input
            type="date"
            value={datumPrijeti}
            onChange={e => setDatumPrijeti(e.target.value)}
            className={inputCls}
          />
        </Field>
      )}

      {/* Datum vzniku */}
      <Field
        label={smer === 'odchozi' ? 'Datum odeslání' : 'Datum vzniku'}
        required
        hint="Určuje rok pro číslo jednací a zahájení skartační lhůty."
      >
        <input
          type="date"
          value={datumVzniku}
          onChange={e => setDatumVzniku(e.target.value)}
          className={inputCls}
        />
      </Field>

      {/* Věcná skupina */}
      <Field label="Věcná skupina" required hint="Skartační znak a lhůta se přeberou automaticky.">
        <select
          value={vecnaSkupinaId}
          onChange={e => setVecnaSkupinaId(e.target.value)}
          className={selectCls}
        >
          <option value="">— vyberte věcnou skupinu —</option>
          {vsOptions.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      {/* Subjekt */}
      <Field label="Odesílatel / adresát">
        <select
          value={subjektId}
          onChange={e => handleSubjektChange(e.target.value)}
          className={selectCls}
        >
          <option value="">— nevybráno —</option>
          {jmennyRejstrik.map(s => (
            <option key={s.id} value={s.id}>
              {s.nazev}{s.id_ds ? ` (DS: ${s.id_ds})` : ''}
            </option>
          ))}
        </select>
        {/* Ruční zadání pokud subjekt není v rejstříku */}
        {!subjektId && (
          <input
            type="text"
            value={subjektNazevCache}
            onChange={e => setSubjektNazevCache(e.target.value)}
            placeholder="nebo zadejte název ručně…"
            className={`${inputCls} mt-2`}
          />
        )}
      </Field>

      {/* DS zpráva ID */}
      <Field
        label="ID datové zprávy (DS)"
        hint="Číslo zprávy z ISDS — nepovinné, pouze pro DS dokumenty."
      >
        <input
          type="number"
          value={dsZpravaId}
          onChange={e => setDsZpravaId(e.target.value)}
          placeholder="např. 1234567"
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

      {/* Neblokující upozornění — audit selhal, dokument vznikl (§91) */}
      {auditWarning && (
        <div className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg space-y-2">
          <p>⚠️ {auditWarning}</p>
          {createdId && (
            <Link
              href={`/dashboard/spisovka/${createdId}`}
              className="inline-block font-medium underline underline-offset-2"
            >
              Pokračovat na detail dokumentu →
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
          {isPending ? 'Ukládám…' : 'Zaevidovat dokument'}
        </button>
      </div>
    </div>
  )
}
