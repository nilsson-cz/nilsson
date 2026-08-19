/**
 * app/dashboard/rozvrh/page.tsx
 * Server Component — director-only správa stálé šablony rozvrhu (Fáze 1).
 * Dlaždice ve „Správa školy". Guard: jen director (RLS navíc vynucuje zápis).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config'
import { DNY_V_TYDNU, casHM, TYP_BLOKU_LABEL, POZICE_LABEL, type StaffOption, type SablonaBlok, type ObsazeniRow } from '@/lib/rozvrh-shared'
import AddBlokForm from './_components/AddBlokForm'
import BlokRow from './_components/BlokRow'

export const metadata = { title: 'Rozvrh — IS Nilsson' }

type Group = { id: string; name: string }

export default async function RozvrhPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string; group?: string }>
}) {
  const sp = await searchParams
  const schoolYear = sp.rok && SCHOOL_YEAR_OPTIONS.includes(sp.rok) ? sp.rok : CURRENT_SCHOOL_YEAR

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  // Demo: v read-only demu (NEXT_PUBLIC_DEMO_MODE) smí číst i readonly inspektor.
  if ((staffRaw as { role?: string } | null)?.role !== 'director' && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Rozvrh</h1>
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
    .map((s) => ({
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      active: !s.employment_end || s.employment_end >= today,
    }))
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1))

  // Dva prosté dotazy + join v JS (nezávislé na PostgREST embed).
  const blokyByDen = new Map<number, SablonaBlok[]>()
  if (selectedGroupId) {
    const { data: blokyRaw } = await supabase
      .from('rozvrh_blok_sablona')
      .select('id, den_v_tydnu, cas_od, cas_do, nazev, typ_bloku, valid_from, valid_to')
      .eq('group_id', selectedGroupId)
      .eq('school_year', schoolYear)
      .order('den_v_tydnu')
      .order('cas_od')
    const bloky = (blokyRaw ?? []) as Omit<SablonaBlok, 'rozvrh_sablona_obsazeni'>[]

    const blokIds = bloky.map((b) => b.id)
    let obsazeniRaw: { id: string; blok_sablona_id: string; staff_id: string; pozice_na_bloku: 'vede' | 'asistuje' }[] = []
    if (blokIds.length > 0) {
      const { data } = await supabase
        .from('rozvrh_sablona_obsazeni')
        .select('id, blok_sablona_id, staff_id, pozice_na_bloku')
        .in('blok_sablona_id', blokIds)
      // DB pozice_na_bloku:string (CHECK vede/asistuje) → app union
      obsazeniRaw = (data ?? []) as typeof obsazeniRaw
    }

    const staffMap = new Map(staff.map((s) => [s.id, s]))
    const obsByBlok = new Map<string, ObsazeniRow[]>()
    for (const o of obsazeniRaw) {
      const st = staffMap.get(o.staff_id)
      const row: ObsazeniRow = {
        id: o.id,
        staff_id: o.staff_id,
        pozice_na_bloku: o.pozice_na_bloku,
        staff: st ? { first_name: st.first_name, last_name: st.last_name } : null,
      }
      const arr = obsByBlok.get(o.blok_sablona_id) ?? []
      arr.push(row)
      obsByBlok.set(o.blok_sablona_id, arr)
    }

    for (const b of bloky) {
      const full: SablonaBlok = { ...b, rozvrh_sablona_obsazeni: obsByBlok.get(b.id) ?? [] }
      const arr = blokyByDen.get(b.den_v_tydnu) ?? []
      arr.push(full)
      blokyByDen.set(b.den_v_tydnu, arr)
    }
  }

  const buildHref = (params: { rok?: string; group?: string }) => {
    const u = new URLSearchParams()
    u.set('rok', params.rok ?? schoolYear)
    if (params.group ?? selectedGroupId) u.set('group', params.group ?? selectedGroupId!)
    return `?${u.toString()}`
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">← Správa školy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Rozvrh — stálá šablona</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Týdenní plán bloků pro třídu. Z něj se pak generuje týden a doplňuje reálné obsazení.
        </p>
        <div className="mt-2 flex gap-4 text-sm">
          <span className="font-medium text-gray-900 dark:text-stone-100">Šablona</span>
          <Link href={`/dashboard/rozvrh/tyden${selectedGroupId ? `?group=${selectedGroupId}` : ''}`} className="text-gray-400 hover:text-gray-700">Týden</Link>
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

          {selectedGroupId && (
            <AddBlokForm groupId={selectedGroupId} schoolYear={schoolYear} validFromDefault={`${schoolYear.split('/')[0]}-09-01`} />
          )}

          {/* Týden */}
          <div className="space-y-4">
            {DNY_V_TYDNU.map((den) => {
              const bloky = blokyByDen.get(den.value) ?? []
              return (
                <div key={den.value}>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-stone-200 mb-2">{den.label}</h3>
                  {bloky.length === 0 ? (
                    <p className="text-xs text-gray-400 pl-1">— žádné bloky —</p>
                  ) : (
                    <div className="space-y-2">
                      {bloky.map((b) => <BlokRow key={b.id} blok={b} staff={staff} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-xs text-gray-400">
            Legenda času: {casHM('08:00:00')}–{casHM('12:00:00')} · pozice: {POZICE_LABEL.vede} / {POZICE_LABEL.asistuje} · typy: {Object.values(TYP_BLOKU_LABEL).join(', ')}
          </p>
        </>
      )}
    </div>
  )
}
