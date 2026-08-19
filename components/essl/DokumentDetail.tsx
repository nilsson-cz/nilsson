'use client'

/**
 * components/essl/DokumentDetail.tsx
 *
 * Client Component — zobrazení a editace detailu dokumentu.
 * Zápis: Supabase UPDATE přes browser client + essl_log() RPC pro audit.
 *
 * Editovatelné: vecna_skupina_id, stav, zpusob_vyrizeni, datum_vyrizeni,
 *               datum_pm, prilohy (GDrive URL), poznamka
 * Read-only:    cislo_jednaci, smer, datum_vzniku, datum_prijeti,
 *               subjekt, ds_zprava_id, skartační info, přiřazené spisy
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import type { DokumentDetail as DokumentDetailType } from '@/lib/essl/queries'
import type { VecnaSkupina, JmennyRejstrikItem, PrilohaItem } from '@/lib/essl/types'
import { esslLog } from '@/lib/essl/esslLog'
import {
  STAV_LABELS,
  SMER_LABELS,
  SKARTACNI_ZNAK_LABELS,
  ZPUSOB_DORUCENI_LABELS,
} from '@/lib/essl/types'

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
}

function buildVsOptions(vecneSkupiny: VecnaSkupina[]) {
  const skupiny = vecneSkupiny.filter(vs => vs.uroven === 1)
  return skupiny.map(sk => ({
    label: `${sk.spis_znak} ${sk.nazev}`,
    options: vecneSkupiny
      .filter(vs => vs.nadrazeny_znak === sk.spis_znak && vs.uroven === 2)
      .flatMap(pod => [
        { value: pod.id, label: `${pod.spis_znak} ${pod.nazev}`, isGroup: true },
        ...vecneSkupiny
          .filter(vs => vs.nadrazeny_znak === pod.spis_znak && vs.uroven === 3)
          .map(detail => ({ value: detail.id, label: `  ${detail.spis_znak} ${detail.nazev}`, isGroup: false })),
      ]),
  }))
}

// ── Sekce helper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 dark:border-stone-800">
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2 border-b border-stone-50 dark:border-stone-800 last:border-0">
      <dt className="w-44 shrink-0 text-sm text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="flex-1 text-sm text-stone-800 dark:text-stone-200">{children}</dd>
    </div>
  )
}

// ── Stav badge ────────────────────────────────────────────────────────────

function StavBadge({ stav }: { stav: string }) {
  const styles: Record<string, string> = {
    prijat:      'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
    prideleno:   'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
    ve_vyrizeni: 'bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300',
    vyrizeno:    'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
    uzavreno:    'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${styles[stav] ?? ''}`}>
      {STAV_LABELS[stav as keyof typeof STAV_LABELS] ?? stav}
    </span>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────

type Props = {
  dokument: DokumentDetailType
  vecneSkupiny: VecnaSkupina[]
  jmennyRejstrik: JmennyRejstrikItem[]
}

// ── Komponenta ────────────────────────────────────────────────────────────

export default function DokumentDetail({ dokument, vecneSkupiny, jmennyRejstrik: _jmennyRejstrik }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  // Neblokující upozornění, pokud uložení projde, ale audit selže (§91).
  const [auditWarning, setAuditWarning] = useState<string | null>(null)

  // Editovatelná pole
  const [vecnaSkupinaId, setVecnaSkupinaId] = useState(dokument.vecna_skupina_id ?? '')
  const [stav, setStav] = useState(dokument.stav)
  const [zpusobVyrizeni, setZpusobVyrizeni] = useState(dokument.zpusob_vyrizeni ?? '')
  const [datumVyrizeni, setDatumVyrizeni] = useState(dokument.datum_vyrizeni ?? '')
  const [datumPm, setDatumPm] = useState(dokument.datum_pm ?? '')
  const [poznamka, setPoznamka] = useState(dokument.poznamka ?? '')
  // GDrive URL — první položka v prilohy nebo prázdný string
  const existingGdrive = (dokument.prilohy as PrilohaItem[]).find(p => p.format === 'GDrive')
  const [gdriveUrl, setGdriveUrl] = useState(existingGdrive?.path ?? '')

  const vsOptions = buildVsOptions(vecneSkupiny)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleSave() {
    setSaveError(null)
    setSaveOk(false)
    setAuditWarning(null)

    // Sestavíme aktualizované prilohy — zachováme ostatní, GDrive přepíšeme/přidáme
    const ostatniPrilohy = (dokument.prilohy as PrilohaItem[]).filter(p => p.format !== 'GDrive')
    const novePrilohy: PrilohaItem[] = gdriveUrl.trim()
      ? [...ostatniPrilohy, { nazev: 'Příloha GDrive', path: gdriveUrl.trim(), format: 'GDrive' }]
      : ostatniPrilohy

    const updates: Record<string, unknown> = {
      vecna_skupina_id:  vecnaSkupinaId || null,
      stav,
      zpusob_vyrizeni:   zpusobVyrizeni || null,
      datum_vyrizeni:    datumVyrizeni || null,
      datum_pm:          datumPm || null,
      poznamka:          poznamka || null,
      prilohy:           novePrilohy,
    }

    const { error: updateError } = await supabase
      .from('dokumenty')
      .update(updates)
      .eq('id', dokument.id)

    if (updateError) {
      setSaveError(updateError.message)
      return
    }

    // Audit log
    const { error: auditError } = await esslLog(supabase, {
      p_operace: 'dokument_vyrizeno',
      p_dokument_id: dokument.id,
      p_detail: { stav_pred: dokument.stav, stav_po: stav },
    })
    if (auditError) {
      // Neblokující: změna je uložena, ale auditní stopa selhala.
      setAuditWarning(
        `Změna byla uložena, ale auditní záznam se nezapsal: ` +
          `${auditError.message}. Kontaktujte správce.`,
      )
    }

    setSaveOk(true)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-4">

      {/* ── Hlavička ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100 font-mono">
            {dokument.cislo_jednaci}
          </h1>
          <p className="text-stone-500 dark:text-stone-400 mt-1 text-sm leading-relaxed max-w-2xl">
            {dokument.predmet}
          </p>
        </div>
        <StavBadge stav={stav} />
      </div>

      {/* ── Základní metadata (read-only) ─────────────────────────────── */}
      <Section title="Metadata dokumentu">
        <dl>
          <Row label="Číslo jednací">
            <span className="font-mono">{dokument.cislo_jednaci}</span>
          </Row>
          <Row label="Směr">
            {SMER_LABELS[dokument.smer]}
          </Row>
          <Row label="Odesílatel / adresát">
            {dokument.subjekt
              ? (
                <span>
                  {dokument.subjekt.nazev}
                  {dokument.subjekt.id_ds && (
                    <span className="ml-2 text-xs text-stone-400 font-mono">DS: {dokument.subjekt.id_ds}</span>
                  )}
                </span>
              )
              : (dokument.subjekt_nazev_cache ?? <span className="text-stone-400">—</span>)
            }
          </Row>
          <Row label="Způsob doručení">
            {dokument.zpusob_doruceni
              ? ZPUSOB_DORUCENI_LABELS[dokument.zpusob_doruceni]
              : <span className="text-stone-400">—</span>
            }
          </Row>
          {dokument.ds_zprava_id && (
            <Row label="DS zpráva ID">
              <span className="font-mono text-sky-600 dark:text-sky-400">{dokument.ds_zprava_id}</span>
            </Row>
          )}
          <Row label="Datum doručení">
            {formatDate(dokument.datum_prijeti)}
          </Row>
          <Row label="Datum vzniku">
            {formatDate(dokument.datum_vzniku)}
          </Row>
        </dl>
      </Section>

      {/* ── Klasifikace a skartace (částečně editovatelné) ────────────── */}
      <Section title="Klasifikace a skartace">
        <dl>
          <Row label="Věcná skupina">
            <select
              value={vecnaSkupinaId}
              onChange={e => setVecnaSkupinaId(e.target.value)}
              className="w-full max-w-sm px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">— nevybráno —</option>
              {vsOptions.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Row>
          <Row label="Skartační znak">
            {dokument.skartacni_znak
              ? SKARTACNI_ZNAK_LABELS[dokument.skartacni_znak]
              : <span className="text-stone-400">—</span>
            }
            <span className="ml-2 text-xs text-stone-400">(přebírá se z věcné skupiny)</span>
          </Row>
          <Row label="Skartační lhůta">
            {dokument.skartacni_lhuta_let != null
              ? `${dokument.skartacni_lhuta_let} let`
              : <span className="text-stone-400">trvalé</span>
            }
          </Row>
          <Row label="Zahájení lhůty">
            {formatDate(dokument.datum_zahajeni_lhuty)}
          </Row>
          <Row label="Datum istění">
            {dokument.datum_isteni
              ? <span className="font-medium">{formatDate(dokument.datum_isteni)}</span>
              : <span className="text-stone-400">trvalé</span>
            }
          </Row>
        </dl>
      </Section>

      {/* ── Vyřízení (editovatelné) ────────────────────────────────────── */}
      <Section title="Vyřízení">
        <dl>
          <Row label="Stav">
            <select
              value={stav}
              onChange={e => setStav(e.target.value as typeof stav)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {Object.entries(STAV_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Row>
          <Row label="Způsob vyřízení">
            <select
              value={zpusobVyrizeni}
              onChange={e => setZpusobVyrizeni(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">— nevybráno —</option>
              <option value="odpoved_odeslana">Odpověď odeslána</option>
              <option value="rozhodnuti_vydano">Rozhodnutí vydáno</option>
              <option value="postoupeno">Postoupeno</option>
              <option value="ulozeno_bez_odpovedi">Uloženo bez odpovědi</option>
              <option value="vzato_na_vedomi">Vzato na vědomí</option>
            </select>
          </Row>
          <Row label="Datum vyřízení">
            <input
              type="date"
              value={datumVyrizeni}
              onChange={e => setDatumVyrizeni(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </Row>
          <Row label="Datum právní moci">
            <input
              type="date"
              value={datumPm}
              onChange={e => setDatumPm(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <span className="ml-2 text-xs text-stone-400">pouze pro správní řízení</span>
          </Row>
        </dl>
      </Section>

      {/* ── Přílohy / GDrive URL ───────────────────────────────────────── */}
      <Section title="Přílohy">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
              Google Drive URL
            </label>
            <input
              type="url"
              value={gdriveUrl}
              onChange={e => setGdriveUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/…"
              className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          {gdriveUrl && (
            <a
              href={gdriveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Otevřít v Google Drive
            </a>
          )}
          {/* Ostatní přílohy (read-only) */}
          {(dokument.prilohy as PrilohaItem[]).filter(p => p.format !== 'GDrive').map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
              <span className="font-mono text-xs bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">{p.format}</span>
              <span>{p.nazev}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Poznámka ──────────────────────────────────────────────────── */}
      <Section title="Poznámka">
        <textarea
          value={poznamka}
          onChange={e => setPoznamka(e.target.value)}
          rows={3}
          placeholder="Interní poznámka ke zpracování…"
          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
        />
      </Section>

      {/* ── Zařazen ve spisu ──────────────────────────────────────────── */}
      {dokument.spisy && dokument.spisy.length > 0 && (
        <Section title="Zařazen ve spisu">
          <ul className="space-y-2">
            {dokument.spisy.map((ds) => (
              <li key={ds.spis_id} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-stone-700 dark:text-stone-300">
                    {ds.spis.spisova_znacka}
                  </span>
                  <span className="text-sm text-stone-500 dark:text-stone-400">
                    {ds.spis.nazev}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    ds.spis.stav === 'otevreny'
                      ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
                  }`}>
                    {ds.spis.stav === 'otevreny' ? 'Otevřený' : 'Uzavřený'}
                  </span>
                </div>
                <Link
                  href={`/dashboard/spisovka/spisy/${ds.spis_id}`}
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap"
                >
                  Otevřít spis →
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Neblokující upozornění — audit selhal, změna uložena (§91) */}
      {auditWarning && (
        <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg mb-2">
          ⚠️ {auditWarning}
        </p>
      )}

      {/* ── Uložit ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <div>
          {saveError && (
            <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>
          )}
          {saveOk && !isPending && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">Uloženo</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/spisovka"
            className="px-4 py-2 text-sm text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
          >
            Zpět
          </Link>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {isPending ? 'Ukládám…' : 'Uložit změny'}
          </button>
        </div>
      </div>
    </div>
  )
}
