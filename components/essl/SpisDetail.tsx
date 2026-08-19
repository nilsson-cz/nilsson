'use client'

/**
 * components/essl/SpisDetail.tsx
 *
 * Detail spisu — metadata, seznam přiřazených dokumentů,
 * přiřazení nového dokumentu, uzavření spisu.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import type { DokumentRow } from '@/lib/essl/types'
import { STAV_LABELS } from '@/lib/essl/types'
import { esslLog } from '@/lib/essl/esslLog'

// ── Typy ──────────────────────────────────────────────────────────────────

type PrirazenyDokument = {
  poradi: number | null
  datum_zarazeni: string
  dokument: {
    id: string
    cislo_jednaci: string
    predmet: string
    stav: string
    datum_vzniku: string
  }
}

type SpisData = {
  id: string
  spisova_znacka: string
  kod_agendy: string
  nazev: string
  stav: 'otevreny' | 'uzavreny'
  datum_otevreni: string
  datum_uzavreni: string | null
  skartacni_znak: string | null
  skartacni_lhuta_let: number | null
  datum_isteni: string | null
  poznamka: string | null
  dokument_spis: PrirazenyDokument[]
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function Section({ title, children, action }: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">{title}</h2>
        {action}
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

// ── Props ─────────────────────────────────────────────────────────────────

type Props = {
  spis: SpisData
  vsechnyDokumenty: DokumentRow[]
}

// ── Komponenta ────────────────────────────────────────────────────────────

export default function SpisDetail({ spis, vsechnyDokumenty }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  // Neblokující upozornění, pokud operace proběhne, ale audit selže (§91).
  const [auditWarning, setAuditWarning] = useState<string | null>(null)

  // Přiřazení dokumentu
  const [vybranyDokumentId, setVybranyDokumentId] = useState('')
  const [prirazujeme, setPrirazujeme] = useState(false)

  // Uzavření spisu
  const [uzavirame, setUzavirame] = useState(false)
  const [datumUzavreni, setDatumUzavreni] = useState(
    new Date().toISOString().slice(0, 10)
  )

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // ID dokumentů již v tomto spisu
  const prirazeneIds = new Set(spis.dokument_spis.map(ds => ds.dokument.id))

  // Dokumenty dostupné k přiřazení (ještě nejsou v tomto spisu)
  const dostupneDokumenty = vsechnyDokumenty.filter(d => !prirazeneIds.has(d.id))

  async function handlePrirazeni() {
    if (!vybranyDokumentId) return
    setError(null)
    setOk(null)
    setAuditWarning(null)

    const { error: insertError } = await supabase
      .from('dokument_spis')
      .insert({
        spis_id:         spis.id,
        dokument_id:     vybranyDokumentId,
        datum_zarazeni:  new Date().toISOString().slice(0, 10),
      })

    if (insertError) {
      setError(insertError.message)
      return
    }

    const { error: auditError } = await esslLog(supabase, {
      p_operace:     'dokument_pridan_do_spisu',
      p_dokument_id: vybranyDokumentId,
      p_spis_id:     spis.id,
      p_detail:      { spisova_znacka: spis.spisova_znacka },
    })
    if (auditError) {
      // Neblokující: dokument je přiřazen, ale auditní stopa selhala.
      setAuditWarning(
        `Dokument byl přiřazen, ale auditní záznam se nezapsal: ` +
          `${auditError.message}. Kontaktujte správce.`,
      )
    }

    setVybranyDokumentId('')
    setPrirazujeme(false)
    setOk('Dokument přiřazen.')
    startTransition(() => router.refresh())
  }

  async function handleUzavreni() {
    setError(null)
    setOk(null)
    setAuditWarning(null)

    const { error: updateError } = await supabase
      .from('spisy')
      .update({
        stav:           'uzavreny',
        datum_uzavreni: datumUzavreni,
      })
      .eq('id', spis.id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    const { error: auditError } = await esslLog(supabase, {
      p_operace: 'spis_uzavren',
      p_spis_id: spis.id,
      p_detail:  { datum_uzavreni: datumUzavreni },
    })
    if (auditError) {
      // Neblokující: spis je uzavřen, ale auditní stopa selhala.
      setAuditWarning(
        `Spis byl uzavřen, ale auditní záznam se nezapsal: ` +
          `${auditError.message}. Kontaktujte správce.`,
      )
    }

    setUzavirame(false)
    setOk('Spis uzavřen.')
    startTransition(() => router.refresh())
  }

  const jeOtevreny = spis.stav === 'otevreny'

  return (
    <div className="space-y-4">

      {/* ── Hlavička ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100 font-mono">
            {spis.spisova_znacka}
          </h1>
          <p className="text-stone-500 dark:text-stone-400 mt-1 text-sm">{spis.nazev}</p>
        </div>
        <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium ${
          jeOtevreny
            ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
            : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
        }`}>
          {jeOtevreny ? 'Otevřený' : 'Uzavřený'}
        </span>
      </div>

      {/* ── Metadata ──────────────────────────────────────────────────── */}
      <Section title="Metadata spisu">
        <dl>
          <Row label="Spisová značka">
            <span className="font-mono">{spis.spisova_znacka}</span>
          </Row>
          <Row label="Kód agendy">{spis.kod_agendy}</Row>
          <Row label="Datum otevření">{formatDate(spis.datum_otevreni)}</Row>
          <Row label="Datum uzavření">{formatDate(spis.datum_uzavreni)}</Row>
          <Row label="Skartační znak">
            {spis.skartacni_znak ?? <span className="text-stone-400">—</span>}
          </Row>
          <Row label="Skartační lhůta">
            {spis.skartacni_lhuta_let != null
              ? `${spis.skartacni_lhuta_let} let`
              : <span className="text-stone-400">—</span>
            }
          </Row>
          <Row label="Datum istění">
            {spis.datum_isteni
              ? <span className="font-medium">{formatDate(spis.datum_isteni)}</span>
              : <span className="text-stone-400">—</span>
            }
          </Row>
          {spis.poznamka && (
            <Row label="Poznámka">{spis.poznamka}</Row>
          )}
        </dl>
      </Section>

      {/* ── Dokumenty ve spisu ────────────────────────────────────────── */}
      <Section
        title={`Dokumenty ve spisu (${spis.dokument_spis.length})`}
        action={
          jeOtevreny && !prirazujeme ? (
            <button
              onClick={() => { setPrirazujeme(true); setOk(null) }}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              + Přiřadit dokument
            </button>
          ) : undefined
        }
      >
        {/* Panel přiřazení */}
        {prirazujeme && (
          <div className="mb-4 p-3 bg-stone-50 dark:bg-stone-800 rounded-lg flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-56">
              <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                Vyberte dokument
              </label>
              <select
                value={vybranyDokumentId}
                onChange={e => setVybranyDokumentId(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">— vyberte —</option>
                {dostupneDokumenty.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.cislo_jednaci} · {d.predmet.slice(0, 60)}{d.predmet.length > 60 ? '…' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setPrirazujeme(false); setVybranyDokumentId('') }}
                className="px-3 py-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
              >
                Zrušit
              </button>
              <button
                onClick={handlePrirazeni}
                disabled={!vybranyDokumentId || isPending}
                className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium transition-colors"
              >
                Přiřadit
              </button>
            </div>
          </div>
        )}

        {/* Seznam přiřazených dokumentů */}
        {spis.dokument_spis.length === 0 ? (
          <p className="text-sm text-stone-400 dark:text-stone-500 py-2">
            Spis zatím neobsahuje žádné dokumenty.
          </p>
        ) : (
          <ul className="divide-y divide-stone-50 dark:divide-stone-800">
            {[...spis.dokument_spis]
              .sort((a, b) => (a.poradi ?? 999) - (b.poradi ?? 999))
              .map((ds) => (
                <li key={ds.dokument.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    {ds.poradi != null && (
                      <span className="w-6 h-6 flex items-center justify-center rounded-full bg-stone-100 dark:bg-stone-800 text-xs text-stone-500 dark:text-stone-400 font-mono shrink-0">
                        {ds.poradi}
                      </span>
                    )}
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-stone-500 dark:text-stone-400 mr-2">
                        {ds.dokument.cislo_jednaci}
                      </span>
                      <span className="text-sm text-stone-800 dark:text-stone-200 truncate">
                        {ds.dokument.predmet}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-stone-400 dark:text-stone-500 hidden sm:block">
                      {formatDate(ds.datum_zarazeni)}
                    </span>
                    <span className="text-xs text-stone-400 dark:text-stone-500">
                      {STAV_LABELS[ds.dokument.stav as keyof typeof STAV_LABELS] ?? ds.dokument.stav}
                    </span>
                    <Link
                      href={`/dashboard/spisovka/${ds.dokument.id}`}
                      className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      Detail →
                    </Link>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Section>

      {/* ── Uzavření spisu ────────────────────────────────────────────── */}
      {jeOtevreny && (
        <Section title="Uzavření spisu">
          {!uzavirame ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Uzavřením spisu se zablokuje přiřazování dalších dokumentů.
              </p>
              <button
                onClick={() => { setUzavirame(true); setOk(null) }}
                className="ml-4 px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors shrink-0"
              >
                Uzavřít spis
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                  Datum uzavření
                </label>
                <input
                  type="date"
                  value={datumUzavreni}
                  onChange={e => setDatumUzavreni(e.target.value)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setUzavirame(false)}
                  className="px-3 py-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
                >
                  Zrušit
                </button>
                <button
                  onClick={handleUzavreni}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded-lg bg-stone-700 hover:bg-stone-800 dark:bg-stone-600 dark:hover:bg-stone-500 disabled:opacity-50 text-white font-medium transition-colors"
                >
                  {isPending ? 'Ukládám…' : 'Potvrdit uzavření'}
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Neblokující upozornění — audit selhal, operace proběhla (§91) */}
      {auditWarning && (
        <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg">
          ⚠️ {auditWarning}
        </p>
      )}

      {/* ── Feedback + navigace ───────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-1">
        <div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {ok && !isPending && <p className="text-sm text-emerald-600 dark:text-emerald-400">{ok}</p>}
        </div>
        <Link
          href="/dashboard/spisovka/spisy"
          className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
        >
          ← Zpět na spisy
        </Link>
      </div>
    </div>
  )
}
