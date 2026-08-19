/**
 * app/dashboard/msmt/page.tsx
 *
 * Přehledová stránka MŠMT výkazů:
 *   - stav prerekvizit (kódy žáků, uzavření pololetí)
 *   - tlačítka ke stažení _01.xml a _01a.xml
 *   - informace o termínech
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const metadata = {
  title: 'MŠMT výkazy | Nilsson',
}

import { CURRENT_SCHOOL_YEAR as SCHOOL_YEAR } from '@/lib/config'
const IZO = process.env.MSMT_IZO ?? '250002639'

export default async function MsmtPage() {
  const supabase = await createSupabaseServerClient()

  // --- Prerekvizita 1: kod_zaka_msmt ---
  const { data: students } = await supabase
    .from('students')
    .select('kod_zaka_msmt')
    .eq('status', 'active')

  const totalStudents = students?.length ?? 0
  const filledCodes   = students?.filter((s) => s.kod_zaka_msmt !== null).length ?? 0
  const allCodesFilled = filledCodes === totalStudents && totalStudents > 0

  // --- Prerekvizita 2: uzavřené 1. pololetí ---
  const { data: summaries } = await supabase
    .from('semester_attendance_summary')
    .select('locked_at')
    .eq('school_year', SCHOOL_YEAR)
    .eq('semester', 1)

  const lockedCount    = summaries?.filter((s) => s.locked_at !== null).length ?? 0
  const allPololeti    = summaries?.length ?? 0
  const allSemLocked   = lockedCount > 0 && lockedCount === totalStudents

  // --- Prerekvizita 3: has_svp žáci s matrikou ---
  const { data: svpStudents } = await supabase
    .from('students')
    .select('id, kod_zaka_msmt, student_matrika_a(pspo)')
    .eq('status', 'active')
    .eq('has_svp', true)

  const svpTotal  = svpStudents?.length ?? 0
  const svpReady  = svpStudents?.filter((s) => {
    const records = Array.isArray(s.student_matrika_a)
      ? s.student_matrika_a
      : s.student_matrika_a
      ? [s.student_matrika_a]
      : []
    const hasRecord = (records as any[]).some((r) => r.pspo > 0)
    return hasRecord && s.kod_zaka_msmt !== null
  }).length ?? 0

  const canGenerateZakladni = allCodesFilled
  const canGenerateSouborA  = svpReady > 0

  // --- Prerekvizity splněny celkově? ---
  const allPrereqsMet = canGenerateZakladni && allSemLocked

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Nadpis */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">MŠMT výkazy</h1>
        <p className="mt-1 text-sm text-gray-500">
          Matriční sběr M3 · Školní rok {SCHOOL_YEAR} · IZO: {IZO}
        </p>
      </div>

      {/* Termíny */}
      <div className="mb-5 p-4 rounded-lg border border-blue-100 bg-blue-50 text-sm">
        <p className="font-medium text-blue-800 mb-1">Termíny odevzdání</p>
        <div className="text-blue-700 space-y-0.5">
          <p>Jarní sběr (RDAT 31. 3.): <strong>do 15. 4. 2026</strong> → KÚ Ústeckého kraje, datová schránka</p>
          <p className="text-xs text-blue-500 mt-1">
            Soubor „b" (zaměstnanci) se odevzdává pouze při podzimním sběru.
          </p>
        </div>
      </div>

      {/* Prerekvizity */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Stav prerekvizit</h2>
        <ul className="space-y-2.5">
          <PrereqRow
            ok={allCodesFilled}
            label={`Kódy žáků MŠMT: ${filledCodes} / ${totalStudents}`}
            actionHref={!allCodesFilled ? '/dashboard/msmt/kody-zaku' : undefined}
            actionLabel="Doplnit →"
          />
          <PrereqRow
            ok={allSemLocked}
            warn={lockedCount > 0 && !allSemLocked}
            label={`Uzavřené 1. pololetí: ${lockedCount} / ${totalStudents} žáků`}
            actionHref={!allSemLocked ? '/dashboard/dochazka' : undefined}
            actionLabel="Uzavřít →"
          />
          <PrereqRow
            ok={svpReady === svpTotal && svpTotal > 0}
            warn={svpTotal > 0 && svpReady < svpTotal}
            label={
              svpTotal === 0
                ? 'Žáci s PO: žádní (soubor „a" bude prázdný)'
                : `Matrika „a" žáků s PO: ${svpReady} / ${svpTotal} připraveno`
            }
            note={
              svpTotal > 0 && svpReady < svpTotal
                ? 'Polák Michael čeká na pspo z PPP'
                : undefined
            }
          />
        </ul>
      </div>

      {/* Generování souborů */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Generovat soubory</h2>
        <p className="text-xs text-gray-400 mb-4">
          Soubory se stáhnou jako windows-1250 XML připravené k odeslání.
        </p>

        <div className="space-y-3">
          {/* _01.xml */}
          <FileRow
            label="Základní soubor"
            filename={`Z${IZO}_01.xml`}
            href={`/api/msmt/xml?type=01&year=${encodeURIComponent(SCHOOL_YEAR)}`}
            enabled={canGenerateZakladni}
            disabledReason={!canGenerateZakladni ? `Chybí ${totalStudents - filledCodes} kódů žáků` : undefined}
          />

          {/* _01a.xml */}
          <FileRow
            label='Soubor „a" — SVP / podpůrná opatření'
            filename={`Z${IZO}_01a.xml`}
            href={`/api/msmt/xml?type=01a&year=${encodeURIComponent(SCHOOL_YEAR)}`}
            enabled={canGenerateSouborA && allCodesFilled}
            disabledReason={
              !allCodesFilled
                ? 'Nejprve doplňte kódy žáků'
                : svpReady === 0
                ? 'Žádní žáci s vyplněným pspo'
                : undefined
            }
            badge={svpReady > 0 ? `${svpReady} žák${svpReady > 1 ? 'é' : ''}` : undefined}
          />

          {/* _01b.xml — placeholder */}
          <div className="flex items-center justify-between py-3 px-4 rounded-md bg-gray-50 border border-dashed border-gray-200 opacity-50">
            <div>
              <p className="text-sm font-medium text-gray-600">Soubor „b" — zaměstnanci</p>
              <p className="text-xs font-mono text-gray-400">Z{IZO}_01b.xml</p>
              <p className="text-xs text-amber-600 mt-0.5">Pouze podzimní sběr · TODO</p>
            </div>
            <span className="px-4 py-1.5 rounded text-sm bg-gray-200 text-gray-400 cursor-not-allowed">
              Stáhnout
            </span>
          </div>
        </div>

        {!allPrereqsMet && (
          <p className="mt-4 text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 border border-amber-200">
            ⚠ Doporučujeme nejprve splnit všechny prerekvizity — zejména uzavřít
            1. pololetí, aby OML_H/NEOML_H obsahovaly správné hodnoty.
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-komponenty (Server)
// ---------------------------------------------------------------------------

function PrereqRow({
  ok,
  warn = false,
  label,
  actionHref,
  actionLabel,
  note,
}: {
  ok: boolean
  warn?: boolean
  label: string
  actionHref?: string
  actionLabel?: string
  note?: string
}) {
  const icon  = ok ? '✓' : warn ? '⚠' : '✗'
  const color = ok
    ? 'text-green-600'
    : warn
    ? 'text-amber-600'
    : 'text-red-500'

  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`${color} mt-0.5 font-medium`}>{icon}</span>
      <span className={ok ? 'text-green-700' : warn ? 'text-amber-700' : 'text-red-700'}>
        {label}
        {note && <span className="ml-1 text-xs text-gray-400">({note})</span>}
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="ml-2 text-blue-600 underline text-xs"
          >
            {actionLabel}
          </Link>
        )}
      </span>
    </li>
  )
}

function FileRow({
  label,
  filename,
  href,
  enabled,
  disabledReason,
  badge,
}: {
  label: string
  filename: string
  href: string
  enabled: boolean
  disabledReason?: string
  badge?: string
}) {
  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-md bg-gray-50 border border-gray-200">
      <div>
        <p className="text-sm font-medium text-gray-800">
          {label}
          {badge && (
            <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </p>
        <p className="text-xs font-mono text-gray-400 mt-0.5">{filename}</p>
        {!enabled && disabledReason && (
          <p className="text-xs text-red-500 mt-0.5">{disabledReason}</p>
        )}
      </div>
      {enabled ? (
        <a
          href={href}
          download
          className="px-4 py-1.5 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
        >
          Stáhnout
        </a>
      ) : (
        <span className="px-4 py-1.5 rounded text-sm font-medium bg-gray-200 text-gray-400 cursor-not-allowed whitespace-nowrap">
          Stáhnout
        </span>
      )}
    </div>
  )
}
