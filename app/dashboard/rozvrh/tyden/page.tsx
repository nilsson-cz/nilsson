/**
 * app/dashboard/rozvrh/tyden/page.tsx
 * Server Component — director-only: vygenerovaný konkrétní týden rozvrhu.
 * Fáze 1: generování ze šablony + read-only zobrazení. Editace reality = další krok.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config'
import { formatDateCZ } from '@/lib/tridni-kniha-missing'
import {
  mondayOf, addDaysStr, weekLabel,
  type KonkretniBlok, type KonkretniObsazeni, type PoziceNaBloku, type StaffOption,
} from '@/lib/rozvrh-shared'
import GenerateWeekButton from '../_components/GenerateWeekButton'
import PregenerovatPanel from '../_components/PregenerovatPanel'
import KonkretniBlokRow from '../_components/KonkretniBlokRow'
import AddKonkretniBlokForm from '../_components/AddKonkretniBlokForm'

export const metadata = { title: 'Rozvrh — týden | IS Nilsson' }

type Group = { id: string; name: string }

export default async function RozvrhTydenPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string; group?: string; week?: string }>
}) {
  const sp = await searchParams
  const schoolYear = sp.rok && SCHOOL_YEAR_OPTIONS.includes(sp.rok) ? sp.rok : CURRENT_SCHOOL_YEAR
  const monday = mondayOf(sp.week || new Date().toISOString().slice(0, 10))
  const friday = addDaysStr(monday, 4)

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  if ((staffRaw as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Rozvrh — týden</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const { data: groupsRaw } = await supabase
    .from('groups').select('id, name').eq('school_year', schoolYear).order('name')
  const groups = (groupsRaw ?? []) as Group[]
  const selectedGroupId = (sp.group && groups.find((g) => g.id === sp.group)?.id) || groups[0]?.id || null

  const today = new Date().toISOString().slice(0, 10)
  const { data: staffRawList } = await supabase
    .from('staff').select('id, first_name, last_name, employment_end').order('last_name')
  const staff: StaffOption[] = ((staffRawList ?? []) as any[])
    .map((s) => ({ id: s.id, first_name: s.first_name, last_name: s.last_name, active: !s.employment_end || s.employment_end >= today }))
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1))
  const staffMap = new Map(staff.map((s) => [s.id, { first_name: s.first_name, last_name: s.last_name }]))

  // Konkrétní bloky týdne pro vybranou třídu — 3 dotazy + JS join.
  const blokyByDatum = new Map<string, KonkretniBlok[]>()
  if (selectedGroupId) {
    const { data: blokyRaw } = await supabase
      .from('rozvrh_blok')
      .select('id, datum, cas_od, cas_do, nazev, typ_bloku, stav, potvrzeno_at')
      .gte('datum', monday)
      .lte('datum', friday)
      .order('datum').order('cas_od')
    const bloky = (blokyRaw ?? []) as Omit<KonkretniBlok, 'obsazeni'>[]
    const blokIds = bloky.map((b) => b.id)

    let groupSet = new Set<string>()
    let obsByBlok = new Map<string, KonkretniObsazeni[]>()
    if (blokIds.length > 0) {
      const [{ data: skupinyRaw }, { data: obsRaw }] = await Promise.all([
        supabase.from('rozvrh_blok_skupiny').select('blok_id, group_id').in('blok_id', blokIds).eq('group_id', selectedGroupId),
        supabase.from('rozvrh_obsazeni').select('id, blok_id, staff_id, pozice_na_bloku, je_suplovani, supluje_za_staff_id').in('blok_id', blokIds),
      ])
      groupSet = new Set<string>(((skupinyRaw ?? []) as any[]).map((r) => r.blok_id))
      for (const o of (obsRaw ?? []) as any[]) {
        const st = staffMap.get(o.staff_id)
        const sz = o.supluje_za_staff_id ? staffMap.get(o.supluje_za_staff_id) : null
        const row: KonkretniObsazeni = {
          id: o.id, staff_id: o.staff_id,
          pozice_na_bloku: o.pozice_na_bloku as PoziceNaBloku,
          je_suplovani: o.je_suplovani,
          supluje_za_staff_id: o.supluje_za_staff_id ?? null,
          staff: st ?? null,
          supluje_za: sz ?? null,
        }
        const arr = obsByBlok.get(o.blok_id) ?? []
        arr.push(row)
        obsByBlok.set(o.blok_id, arr)
      }
    }

    for (const b of bloky) {
      if (!groupSet.has(b.id)) continue // jen bloky vybrané třídy
      const full: KonkretniBlok = { ...b, obsazeni: obsByBlok.get(b.id) ?? [] }
      const arr = blokyByDatum.get(b.datum) ?? []
      arr.push(full)
      blokyByDatum.set(b.datum, arr)
    }
  }

  const dny = [0, 1, 2, 3, 4].map((i) => addDaysStr(monday, i))
  const buildHref = (p: { rok?: string; group?: string; week?: string }) => {
    const u = new URLSearchParams()
    u.set('rok', p.rok ?? schoolYear)
    if (p.group ?? selectedGroupId) u.set('group', p.group ?? selectedGroupId!)
    u.set('week', p.week ?? monday)
    return `?${u.toString()}`
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">← Správa školy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Rozvrh — týden</h1>
        {/* Podnavigace */}
        <div className="mt-2 flex gap-4 text-sm">
          <Link href={`/dashboard/rozvrh${selectedGroupId ? `?group=${selectedGroupId}` : ''}`} className="text-gray-400 hover:text-gray-700">Šablona</Link>
          <span className="font-medium text-gray-900 dark:text-stone-100">Týden</span>
        </div>
      </div>

      {/* Školní rok */}
      <div className="flex flex-wrap items-center gap-2">
        {SCHOOL_YEAR_OPTIONS.map((y) => (
          <Link key={y} href={buildHref({ rok: y, group: undefined })}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
              y === schoolYear ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-stone-700 dark:text-stone-300'}`}>
            {y}
          </Link>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Pro školní rok {schoolYear} nejsou definované žádné třídy.
        </div>
      ) : (
        <>
          {/* Třídy */}
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 dark:border-stone-800 pb-3">
            {groups.map((g) => (
              <Link key={g.id} href={buildHref({ group: g.id })}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  g.id === selectedGroupId ? 'bg-gray-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-stone-300 dark:hover:bg-stone-800'}`}>
                Třída {g.name}
              </Link>
            ))}
          </div>

          {/* Navigace týdnů + generování */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link href={buildHref({ week: mondayOf(addDaysStr(monday, -7)) })} className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-gray-300 dark:border-stone-700">←</Link>
              <span className="text-sm font-medium text-gray-800 dark:text-stone-200 min-w-[10rem] text-center">{weekLabel(monday)}</span>
              <Link href={buildHref({ week: mondayOf(addDaysStr(monday, 7)) })} className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-gray-300 dark:border-stone-700">→</Link>
              <Link href={buildHref({ week: mondayOf(new Date().toISOString().slice(0, 10)) })} className="ml-1 text-xs text-gray-400 hover:text-gray-600">dnes</Link>
            </div>
            {selectedGroupId && <GenerateWeekButton groupId={selectedGroupId} monday={monday} />}
          </div>

          {selectedGroupId && (
            <div className="flex">
              <PregenerovatPanel groupId={selectedGroupId} monday={monday} />
            </div>
          )}

          {/* Dny */}
          <div className="space-y-4">
            {dny.map((datum) => {
              const bloky = blokyByDatum.get(datum) ?? []
              return (
                <div key={datum}>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-stone-200 mb-2 capitalize">{formatDateCZ(datum)}</h3>
                  {bloky.length === 0 ? (
                    <p className="text-xs text-gray-400 pl-1">— žádné bloky —</p>
                  ) : (
                    <div className="space-y-2">
                      {bloky.map((b) => <KonkretniBlokRow key={b.id} blok={b} staff={staff} />)}
                    </div>
                  )}
                  {selectedGroupId && (
                    <AddKonkretniBlokForm
                      groupId={selectedGroupId}
                      schoolYear={schoolYear}
                      datum={datum}
                      staff={staff}
                    />
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-xs text-gray-400">
            Generování je bezpečné opakovat — víkendy a dny bez výuky se přeskakují, existující bloky zůstanou.
            Na bloku lze přeobsadit osoby, zadat suplování (za koho) a blok zrušit/obnovit. „⚠ Bez obsazení" značí blok, který nikdo nezajišťuje.
          </p>
        </>
      )}
    </div>
  )
}
