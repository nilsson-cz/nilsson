/**
 * app/dashboard/msmt/page.tsx
 *
 * Přehledová stránka MŠMT výkazů (matrika):
 *   - volba sběru: jarní (RDAT 31. 3.) / podzimní (RDAT 30. 9.) — ?sber=podzimni-2026
 *   - stav prerekvizit (údaje žáků, uzavřené pololetí dle sběru, doporučení ŠPZ ve VP)
 *   - tlačítka ke stažení _01.xml, _01a.xml a (podzim) _01b.xml
 * Pravidla sběrů: lib/msmt-sber.ts (metodika MŠMT).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { zkontrolujRodneCislo } from '@/lib/rodne-cislo'
import { stprKod } from '@/lib/msmt-xml'
import { chybejiciPobyt } from '@/lib/msmt-pobyt'
import { StahnoutXml } from './_components/StahnoutXml'
import { msmtEnv } from '@/lib/msmt-env'
import { nactiDataSouboruA, obdobiA, jeRelevantniProA, kontrolaDoporuceni } from '@/lib/msmt-soubor-a'
import { nactiDataSouboruB, vetySouboruB } from '@/lib/msmt-soubor-b'
import type { ReactNode } from 'react'
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
    .select('id, first_name, last_name, birth_number, enrollment_date, withdrawal_date, kod_zaka_msmt')
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
        .select('id, msmt_odhl, msmt_izop, kod_zahajeni, citizenship, msmt_kstpr, msmt_stitek')
        .in('id', students.map((s) => s.id))
    : { data: [] }
  const udaje = new Map(
    ((udajeRaw ?? []) as { id: string; msmt_odhl: string | null; msmt_izop: string | null; kod_zahajeni: string | null; citizenship: string | null; msmt_kstpr: string | null; msmt_stitek: string | null }[])
      .map((u) => [u.id, u]),
  )
  const totalStudents  = students.length
  const filledCodes    = students.filter((s) => {
    const u = udaje.get(s.id)
    return zkontrolujRodneCislo(s.birth_number).stav === 'ok'
      && !!u?.msmt_odhl && !!u?.msmt_izop && !!u?.kod_zahajeni && !!stprKod(u?.citizenship)
      && chybejiciPobyt(u?.citizenship, u?.msmt_kstpr, u?.msmt_stitek).length === 0
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

  // --- Prerekvizita 3: doporučení ŠPZ ve VP (zdroj souboru „a“ — lib/msmt-soubor-a.ts) ---
  const dataA = await nactiDataSouboruA(supabase, students.map((s) => s.id))
  const zaciA = students.filter((s) =>
    obdobiA(dataA, s.id, s.enrollment_date)
      .some((o) => o.od <= sber.obdobiDo && (!o.do || o.do >= sber.obdobiOd) && jeRelevantniProA(o)))
  const kontroly = students
    .map((s) => ({ s, k: kontrolaDoporuceni(dataA, s.id, sber.obdobiOd, sber.obdobiDo) }))
    .filter((x): x is { s: typeof students[number]; k: NonNullable<typeof x.k> } => x.k !== null)
  const poTotal     = kontroly.length
  const poChyby     = kontroly.filter((x) => x.k.problemy.length > 0)
  const poUpozorneni = kontroly.filter((x) => x.k.problemy.length === 0 && x.k.upozorneni.length > 0)
  const poReady     = poTotal - poChyby.length

  // --- Soubor „b“ (jen podzim): věty z vp_podpurna_opatreni (lib/msmt-soubor-b.ts) ---
  const jmenoZaka = new Map(students.map((s) => [s.id, `${s.last_name} ${s.first_name}`]))
  const souborB = sber.souborB
    ? vetySouboruB(
        await nactiDataSouboruB(supabase, students.map((s) => s.id)),
        students.map((s) => ({ id: s.id, jmeno: jmenoZaka.get(s.id)!, kod_zaka_msmt: s.kod_zaka_msmt })),
        sber,
      )
    : null

  const canGenerateZakladni = allCodesFilled
  const canGenerateSouborA  = zaciA.length > 0 && poChyby.length === 0

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

      {/* Výkonové výkazy (mimo matriku) */}
      <Link
        href="/dashboard/msmt/z201"
        className="mb-5 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm hover:bg-gray-50"
      >
        <span>
          <span className="font-medium text-gray-800">Z 2-01 — výkaz o školní družině</span>
          <span className="block text-xs text-gray-500">Stav k 31. 10., vyplňuje se ve sberdat.uiv.cz</span>
        </span>
        <span className="text-gray-400">→</span>
      </Link>

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
            label={`Kompletní údaje žáků (RČ, ODHL, IZOP, KOD_ZAH, pobyt cizinců): ${filledCodes} / ${totalStudents}`}
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
            ok={poChyby.length === 0 && poUpozorneni.length === 0}
            warn={poChyby.length === 0 && poUpozorneni.length > 0}
            label={
              poTotal === 0
                ? 'Žáci s PO ve VP: žádní'
                : `Doporučení ŠPZ žáků s PO (modul VP): ${poReady} / ${poTotal} kompletní`
            }
            details={
              [...poChyby, ...poUpozorneni].length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {[...poChyby, ...poUpozorneni].map(({ s, k }) => (
                    <li key={s.id} className={k.problemy.length ? 'text-red-700' : 'text-amber-700'}>
                      {s.last_name} {s.first_name}: {[...k.problemy, ...k.upozorneni].join('; ')}
                      {k.careId && (
                        <Link href={`/dashboard/vp/${k.careId}`} className="ml-2 text-blue-600 underline">
                          Karta VP →
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : undefined
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
                : poChyby.length > 0
                ? 'Nejprve doplňte doporučení ŠPZ ve VP'
                : zaciA.length === 0
                ? 'Žádní žáci se SVP / PO'
                : undefined
            }
            badge={zaciA.length > 0 ? `${zaciA.length} ${zaciA.length === 1 ? 'žák' : zaciA.length < 5 ? 'žáci' : 'žáků'}` : undefined}
          />

          {/* _01b.xml — jen podzim */}
          {sber.souborB && souborB && (
            <FileRow
              label="Soubor „b“ — podpůrná opatření s kódem NFN"
              filename={`Z${IZO}_01b.xml`}
              href={`/api/msmt/xml?type=01b&${q}`}
              enabled={allCodesFilled && souborB.chyby.length === 0 && souborB.vety.length > 0}
              disabledReason={
                !allCodesFilled
                  ? 'Nejprve doplňte údaje žáků'
                  : souborB.chyby.length > 0
                  ? `Doplňte ve VP: ${souborB.chyby.join('; ')}`
                  : souborB.vety.length === 0
                  ? 'Žádná poskytovaná opatření s kódem NFN — ve sběrové aplikaci zaškrtněte, že soubor „b“ nepředáváte.'
                  : undefined
              }
              badge={souborB.vety.length > 0 ? `${souborB.vety.length} opatření` : undefined}
              note={souborB.nezahajena.length > 0
                ? `Bez data skutečného zahájení (do „b“ nejdou): ${souborB.nezahajena
                    .map((n) => `${jmenoZaka.get(n.studentId) ?? ''} ${n.kod_nfn}`).join(', ')}`
                : undefined}
            />
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
  details,
}: {
  ok: boolean
  warn?: boolean
  label: string
  actionHref?: string
  actionLabel?: string
  note?: string
  details?: ReactNode
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
        {details}
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
  note,
}: {
  label: string
  filename: string
  href: string
  enabled: boolean
  disabledReason?: string
  badge?: string
  note?: string
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
        {note && <p className="text-xs text-amber-600 mt-0.5">{note}</p>}
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
