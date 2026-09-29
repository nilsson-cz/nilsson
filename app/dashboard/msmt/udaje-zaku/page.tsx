// app/dashboard/msmt/udaje-zaku/page.tsx
// Údaje žáků pro matriku MŠMT (director-only) — co export (ZS.025) potřebuje
// a co se do IS nedostane samo:
//   RODC     — rodné číslo (students.birth_number, plní zápis) — kontrola/oprava
//   ODHL     — předchozí vzdělávání, číselník RAPD (students.msmt_odhl, migrace 130)
//   IZOP     — IZO školy, ze které žák přišel (students.msmt_izop, migrace 130)
//   KOD_ZAH  — kód zahájení docházky, číselník RAZD (students.kod_zahajeni)
// KOD_ZAKA pro soubor „a" se jen zobrazuje — náhodné neduplicitní pětimístné
// číslo přidělené jednou pro vždy (trigger, migrace 131).
// Výběr žáků = stejný jako export pro zvolený sběr (vč. odešlých v období).

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { zkontrolujRodneCislo } from '@/lib/rodne-cislo'
import { parseSber } from '@/lib/msmt-sber'
import { stprKod } from '@/lib/msmt-xml'
import { UdajeZakaRow, type UdajeZaka } from './_components/UdajeZakaRow'

export const metadata = {
  title: 'Údaje žáků pro MŠMT | Nilsson',
}

type Row = {
  id: string; first_name: string; last_name: string; status: string
  birth_date: string | null; birth_number: string | null; kod_zaka_msmt: string | null
  msmt_odhl: string | null; msmt_izop: string | null; kod_zahajeni: string | null
  citizenship: string | null; predchozi_skola_izo: string | null
}

export default async function UdajeZakuPage({
  searchParams,
}: {
  searchParams: Promise<{ sber?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const sber = parseSber((await searchParams).sber)

  const { data: { user } } = await supabase.auth.getUser()
  const { data: staff } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  if (staff?.role !== 'director') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Údaje žáků pro MŠMT</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const { data: raw, error } = await supabase
    .from('students')
    .select('id, first_name, last_name, status, birth_date, birth_number, kod_zaka_msmt, msmt_odhl, msmt_izop, kod_zahajeni, citizenship, predchozi_skola_izo')
    .in('status', ['active', 'withdrawn'])
    .lte('enrollment_date', sber.obdobiDo)
    .or(`withdrawal_date.is.null,withdrawal_date.gte.${sber.obdobiOd}`)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  if (error) {
    return <div className="p-6 text-red-600">Chyba při načítání žáků: {error.message}</div>
  }

  const rows = (raw ?? []) as Row[]
  const zaci: (UdajeZaka & { dosavadniSkola: string | null; kompletni: boolean })[] = rows.map((s) => {
    const rc = zkontrolujRodneCislo(s.birth_number)
    const stpr = stprKod(s.citizenship)
    return {
      id: s.id,
      jmeno: `${s.last_name} ${s.first_name}`,
      odesel: s.status === 'withdrawn',
      birth_date: s.birth_date,
      kod_zaka_msmt: s.kod_zaka_msmt,
      birth_number: rc.formatovane ?? s.birth_number,
      msmt_odhl: s.msmt_odhl,
      msmt_izop: s.msmt_izop,
      kod_zahajeni: s.kod_zahajeni,
      stpr,
      citizenship: s.citizenship,
      // predchozi_skola_izo obsahuje u žáků ze zápisu NÁZEV dosavadní školy.
      dosavadniSkola: s.predchozi_skola_izo && !/^\d{9}$/.test(s.predchozi_skola_izo) ? s.predchozi_skola_izo : null,
      kompletni: rc.stav === 'ok' && !!s.msmt_odhl && !!s.msmt_izop && !!s.kod_zahajeni && !!stpr,
    }
  })

  const total = zaci.length
  const hotovo = zaci.filter((z) => z.kompletni).length
  const pct = total > 0 ? Math.round((hotovo / total) * 100) : 0

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Údaje žáků pro MŠMT</h1>
        <p className="mt-1 text-sm text-gray-500">
          Údaje, které matrika MŠMT vyžaduje a které se do IS nedostanou samy. Rodné číslo
          (RODC) se bere z karty žáka; předchozí vzdělávání (ODHL), IZO předchozí školy
          (IZOP) a kód zahájení docházky (KOD_ZAH) doplníte tady. Soubor „a“ používá místo
          rodného čísla kód žáka (KOD_ZAKA).
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Žáci pro {sber.popis} (včetně těch, kteří v období odešli).
        </p>
      </div>

      <div className="mb-6 p-4 rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Žáci s kompletními údaji</span>
          <span className="text-sm text-gray-500">
            {hotovo} / {total}
            {total - hotovo > 0 && <span className="ml-2 text-red-500 font-medium">({total - hotovo} k doplnění)</span>}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
        <p>
          <strong>Zadávání:</strong> klikněte do pole, zadejte hodnotu a potvrďte Enterem nebo
          opuštěním pole; Esc změnu zruší. Pole nabízí hodnoty použité v předchozích sbězích.
        </p>
        <p>
          <strong>IZOP</strong> = IZO mateřské / základní školy, ze které žák přišel (dohledáte
          v rejstříku škol). Dosud nechodil do školy: <code className="font-mono">000000000</code>;
          zahraniční škola: <code className="font-mono">999999</code> + kód státu.
        </p>
      </div>

      {/* Nabídky hodnot (datalist) — kódy z přijatých souborů MŠMT a metodiky */}
      <datalist id="msmt-odhl">
        <option value="010">nástup z mateřské školy (1. ročník)</option>
        <option value="101">ze ZŠ — žák 2. ročníku</option>
        <option value="102">ze ZŠ — žák 3. ročníku</option>
        <option value="103">ze ZŠ — žák 4. ročníku</option>
        <option value="104">ze ZŠ — žák 5. ročníku</option>
      </datalist>
      <datalist id="msmt-izop">
        <option value="000000000">dosud nechodil do žádné školy</option>
        <option value="000000203">škola v ČR, která už neexistuje</option>
      </datalist>
      <datalist id="msmt-kod-zah">
        <option value="1">řádný nástup do 1. ročníku</option>
        <option value="2">nástup po odkladu</option>
        <option value="E">přestup z jiné ZŠ</option>
      </datalist>

      <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {['Žák', 'Rodné číslo', 'ODHL', 'IZOP', 'KOD_ZAH', 'Kód „a“'].map((h) => (
                <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zaci.map((z) => (
              <UdajeZakaRow key={z.id} zak={z} dosavadniSkola={z.dosavadniSkola} />
            ))}
            {zaci.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400">
                  Žádní žáci v období sběru.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
