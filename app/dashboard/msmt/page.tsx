/**
 * app/dashboard/msmt/page.tsx
 *
 * Přehledová stránka MŠMT výkazů (matrika):
 *   - volba sběru: jarní (RDAT 31. 3.) / podzimní (RDAT 30. 9.) — ?sber=podzimni-2026
 *   - stav prerekvizit (rodná čísla, uzavřené pololetí dle sběru, matrika „a")
 *   - tlačítka ke stažení _01.xml a _01a.xml
 * Pravidla sběrů: lib/msmt-sber.ts (metodika MŠMT).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { zkontrolujRodneCislo } from '@/lib/rodne-cislo'
import { stprKod } from '@/lib/msmt-xml'
import { StahnoutXml } from './_components/StahnoutXml'
import { msmtEnv } from '@/lib/msmt-env'
import {
  parseSber,
  sberKontext,
  sberParam,
  zakVObdobi,
  type SberKontext,
} from '@/lib/msmt-sber'

export const metadata = {
  title: 'MŠMT výkazy | Nilsson',
}

const IZO = msmtEnv().izo || '250002639'

/** Tři poslední sběry (vybraný default + dva předchozí) pro přepínač. */
function nabidkaSberu(k: SberKontext): SberKontext[] {
  const out: SberKontext[] = [k]
  let cur = k
  for (let i = 0; i < 2; i++) {
    cur = cur.sber === 'podzimni' ? sberKontext('jarni', cur.rok) : sberKontext('podzimni', cur.rok - 1)
    out.push(cur)
  }
  return out
}

/** Interval pololetí, za které se vykazují zameškané hodiny (ISO). */
function omlInterval(k: SberKontext): { od: string; do: string } {
  const [r1, r2] = k.omlSkolniRok.split('/')
  return k.omlPololeti === 1
    ? { od: `${r1}-09-01`, do: `${r2}-01-31` }
    : { od: `${r2}-02-01`, do: `${r2}-06-30` }
}

export default async function MsmtPage({
  searchParams,
}: {
  searchParams: Promise<{ sber?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { sber: sberRaw } = await searchParams
  const vychozi = parseSber(null)
  const sber = parseSber(sberRaw)
  const nabidka = nabidkaSberu(vychozi)
  if (!nabidka.some((n) => sberParam(n) === sberParam(sber))) nabidka.unshift(sber)

  // Žáci, jejichž docházka zasahuje do období sběru (vč. odešlých) — stejný
  // výběr jako export (app/api/msmt/xml).
  const { data: studentsRaw } = await supabase
    .from('students')
    .select('id, first_name, last_name, birth_number, enrollment_date, withdrawal_date, has_svp, kod_zaka_msmt, student_matrika_a(pspo)')
    .in('status', ['active', 'withdrawn'])
    .lte('enrollment_date', sber.obdobiDo)
    .or(`withdrawal_date.is.null,withdrawal_date.gte.${sber.obdobiOd}`)
  const students = (studentsRaw ?? []).filter((s) =>
    zakVObdobi(s.enrollment_date, s.withdrawal_date, sber),
  )

  // --- Prerekvizita 1: kompletní ručně zadávané údaje (RODC, ODHL, IZOP,
  // KOD_ZAH, občanství) — stejná pravidla jako /dashboard/msmt/udaje-zaku.
  const { data: udajeRaw } = students.length
    ? await supabase
        .from('students')
        .select('id, msmt_odhl, msmt_izop, kod_zahajeni, citizenship')
        .in('id', students.map((s) => s.id))
    : { data: [] }
  const udaje = new Map(
    ((udajeRaw ?? []) as { id: string; msmt_odhl: string | null; msmt_izop: string | null; kod_zahajeni: string | null; citizenship: string | null }[])
      .map((u) => [u.id, u]),
  )
  const totalStudents  = students.length
  const filledCodes    = students.filter((s) => {
    const u = udaje.get(s.id)
    return zkontrolujRodneCislo(s.birth_number).stav === 'ok'
      && !!u?.msmt_odhl && !!u?.msmt_izop && !!u?.kod_zahajeni && !!stprKod(u?.citizenship)
  }).length
  const allCodesFilled = filledCodes === totalStudents && totalStudents > 0

  // --- Prerekvizita 2: uzavřené pololetí, za které se vykazují hodiny ---
  // Jaro: 1. pololetí aktuálního roku; podzim: 2. pololetí předchozího roku.
  const oml = omlInterval(sber)
  const semStudents = students.filter((s) =>
    zakVObdobi(s.enrollment_date, s.withdrawal_date, { obdobiOd: oml.od, obdobiDo: oml.do }),
  )
  const { data: summaries } = semStudents.length
    ? await supabase
        .from('semester_attendance_summary')
        .select('student_id, locked_at')
        .eq('school_year', sber.omlSkolniRok)
        .eq('semester', sber.omlPololeti)
        .in('student_id', semStudents.map((s) => s.id))
    : { data: [] as { student_id: string; locked_at: string | null }[] }

  const lockedCount  = (summaries ?? []).filter((s) => s.locked_at !== null).length
  const semTotal     = semStudents.length
  const allSemLocked = semTotal > 0 && lockedCount === semTotal
  const uzavritHref  =
    `/dashboard/uzavreni-pololeti?year=${encodeURIComponent(sber.omlSkolniRok)}&semester=${sber.omlPololeti}`

  // --- Prerekvizita 3: žáci s PO mají záznam matriky „a" (pspo > 0) ---
  const svpStudents = students.filter((s) => s.has_svp)
  const svpNotReady = svpStudents.filter((s) => {
    const records = Array.isArray(s.student_matrika_a)
      ? s.student_matrika_a
      : s.student_matrika_a
      ? [s.student_matrika_a]
      : []
    const hasRecord = (records as { pspo: number }[]).some((r) => r.pspo > 0)
    return !(hasRecord && s.kod_zaka_msmt !== null)
  })
  const svpTotal = svpStudents.length
  const svpReady = svpTotal - svpNotReady.length

  const canGenerateZakladni = allCodesFilled
  const canGenerateSouborA  = svpReady > 0

  const allPrereqsMet = canGenerateZakladni && allSemLocked
  const q = `sber=${sberParam(sber)}`

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Nadpis */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">MŠMT výkazy</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sběr dat ze školní matriky · IZO: {IZO}
        </p>
      </div>

      {/* Volba sběru */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {nabidka.map((n) => (
          <Link
            key={sberParam(n)}
            href={`/dashboard/msmt?sber=${sberParam(n)}`}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              sberParam(n) === sberParam(sber)
                ? 'bg-stone-800 text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {n.sber === 'jarni' ? 'Jaro' : 'Podzim'} {n.rok}
          </Link>
        ))}
      </div>

      {/* Parametry sběru */}
      <div className="mb-5 p-4 rounded-lg border border-blue-100 bg-blue-50 text-sm">
        <p className="font-medium text-blue-800 mb-1">
          {sber.popis.charAt(0).toUpperCase() + sber.popis.slice(1)}
        </p>
        <div className="text-blue-700 space-y-0.5">
          <p>Odevzdání: <strong>{sber.termin}</strong> → KÚ Ústeckého kraje (přesný termín stanoví KÚ)</p>
          <p>
            Předávají se věty platné v období {fmt(sber.obdobiOd)} – {fmt(sber.obdobiDo)}
            {sber.sber === 'podzimni' && ' (i žáci, kteří mezitím odešli)'}.
          </p>
          <p>
            Zameškané hodiny za {sber.omlPololeti}. pololetí {sber.omlSkolniRok}
            {sber.sber === 'podzimni' ? ' (předchozí školní rok)' : ''}.
          </p>
          {sber.souborB && (
            <p className="text-xs text-blue-500 mt-1">
              Na podzim se předává i soubor „b“ — podpůrná opatření 2.–5. stupně k 30. 9.
            </p>
          )}
        </div>
      </div>

      {/* Prerekvizity */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Stav prerekvizit</h2>
        <ul className="space-y-2.5">
          <PrereqRow
            ok={allCodesFilled}
            label={`Kompletní údaje žáků (RČ, ODHL, IZOP, KOD_ZAH): ${filledCodes} / ${totalStudents}`}
            actionHref={`/dashboard/msmt/udaje-zaku?${q}`}
            actionLabel={allCodesFilled ? 'Zobrazit →' : 'Doplnit →'}
          />
          <PrereqRow
            ok={allSemLocked}
            warn={lockedCount > 0 && !allSemLocked}
            label={`Uzavřené ${sber.omlPololeti}. pololetí ${sber.omlSkolniRok}: ${lockedCount} / ${semTotal} žáků`}
            actionHref={!allSemLocked ? uzavritHref : undefined}
            actionLabel="Uzavřít →"
          />
          <PrereqRow
            ok={svpReady === svpTotal && svpTotal > 0}
            warn={svpTotal > 0 && svpReady < svpTotal}
            label={
              svpTotal === 0
                ? 'Žáci s PO: žádní (soubor „a“ bude prázdný)'
                : `Matrika „a“ žáků s PO: ${svpReady} / ${svpTotal} připraveno`
            }
            note={
              svpNotReady.length > 0
                ? `bez stupně PO: ${svpNotReady.map((s) => `${s.last_name} ${s.first_name}`).join(', ')}`
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
            href={`/api/msmt/xml?type=01&${q}`}
            enabled={canGenerateZakladni}
            disabledReason={!canGenerateZakladni ? `${totalStudents - filledCodes} žákům chybí údaje pro MŠMT` : undefined}
          />

          {/* _01a.xml */}
          <FileRow
            label="Soubor „a“ — SVP / podpůrná opatření"
            filename={`Z${IZO}_01a.xml`}
            href={`/api/msmt/xml?type=01a&${q}`}
            enabled={canGenerateSouborA && allCodesFilled}
            disabledReason={
              !allCodesFilled
                ? 'Nejprve doplňte údaje žáků'
                : svpReady === 0
                ? 'Žádní žáci s vyplněným pspo'
                : undefined
            }
            badge={svpReady > 0 ? `${svpReady} žák${svpReady > 1 ? 'é' : ''}` : undefined}
          />

          {/* _01b.xml — jen podzim, zatím není */}
          {sber.souborB && (
            <div className="flex items-center justify-between py-3 px-4 rounded-md bg-gray-50 border border-dashed border-gray-200 opacity-50">
              <div>
                <p className="text-sm font-medium text-gray-600">Soubor „b“ — podpůrná opatření 2.–5. stupně</p>
                <p className="text-xs font-mono text-gray-400">Z{IZO}_01b.xml</p>
                <p className="text-xs text-amber-600 mt-0.5">Pouze podzimní sběr · zatím není hotový</p>
              </div>
              <span className="px-4 py-1.5 rounded text-sm bg-gray-200 text-gray-400 cursor-not-allowed">
                Stáhnout
              </span>
            </div>
          )}
        </div>

        {!allPrereqsMet && (
          <p className="mt-4 text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 border border-amber-200">
            ⚠ Doporučujeme nejprve splnit všechny prerekvizity — zejména uzavřít{' '}
            {sber.omlPololeti}. pololetí {sber.omlSkolniRok}, aby OML_H/NEOML_H obsahovaly
            správné hodnoty.
          </p>
        )}
      </div>
    </div>
  )
}

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)}. ${Number(m)}. ${y}`
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
        <StahnoutXml href={href} filename={filename} />
      ) : (
        <span className="px-4 py-1.5 rounded text-sm font-medium bg-gray-200 text-gray-400 cursor-not-allowed whitespace-nowrap">
          Stáhnout
        </span>
      )}
    </div>
  )
}
