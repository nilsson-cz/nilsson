/**
 * app/dashboard/muj-rozvrh/page.tsx
 * Server Component — vlastní týdenní rozvrh přihlášeného zaměstnance.
 * Pro průvodce/asistenty (i director/vp). Read-only. Kontroluje multiplicitu
 * (překryv vlastních bloků) — ten značí chybu v obsazení (K5).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { formatDateCZ } from '@/lib/tridni-kniha-missing'
import {
  casHM, TYP_BLOKU_LABEL, POZICE_LABEL, mondayOf, addDaysStr, weekLabel,
  type TypBloku, type PoziceNaBloku, type StavBloku,
} from '@/lib/rozvrh-shared'

export const metadata = { title: 'Můj rozvrh — IS Nilsson' }

type MujBlok = {
  id: string
  datum: string
  cas_od: string
  cas_do: string
  nazev: string
  typ_bloku: TypBloku
  stav: StavBloku
  potvrzeno_at: string | null
  pozice: PoziceNaBloku
  je_suplovani: boolean
  supluje_za: string | null
  tridy: string[]
  kolize: boolean
  groupId: string | null
}

export default async function MujRozvrhPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const sp = await searchParams
  const monday = mondayOf(sp.week || new Date().toISOString().slice(0, 10))
  const friday = addDaysStr(monday, 4)

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('id').eq('user_id', user!.id).maybeSingle()
  const myId = (me as { id: string } | null)?.id
  if (!myId) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Můj rozvrh</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tvůj účet není propojen se zaměstnaneckým záznamem.
        </div>
      </div>
    )
  }

  // Bloky týdne → moje obsazení → třídy + suplování
  const { data: blokyRaw } = await supabase
    .from('rozvrh_blok')
    .select('id, datum, cas_od, cas_do, nazev, typ_bloku, stav, potvrzeno_at')
    .gte('datum', monday).lte('datum', friday)
  const blokyById = new Map<string, any>(((blokyRaw ?? []) as any[]).map((b) => [b.id, b]))
  const blokIds = [...blokyById.keys()]

  const byDatum = new Map<string, MujBlok[]>()
  let pocet = 0
  if (blokIds.length > 0) {
    const { data: myObsRaw } = await supabase
      .from('rozvrh_obsazeni')
      .select('blok_id, pozice_na_bloku, je_suplovani, supluje_za_staff_id')
      .eq('staff_id', myId).in('blok_id', blokIds)
    const myObs = (myObsRaw ?? []) as any[]
    const myBlokIds = myObs.map((o) => o.blok_id)

    let tridyByBlok = new Map<string, string[]>()
    const firstGroupByBlok = new Map<string, string>()
    const staffMap = new Map<string, string>()
    if (myBlokIds.length > 0) {
      const [{ data: skupinyRaw }, { data: groupsRaw }, { data: staffRaw }] = await Promise.all([
        supabase.from('rozvrh_blok_skupiny').select('blok_id, group_id').in('blok_id', myBlokIds),
        supabase.from('groups').select('id, name'),
        supabase.from('staff').select('id, first_name, last_name'),
      ])
      const groupName = new Map<string, string>(((groupsRaw ?? []) as any[]).map((g) => [g.id, g.name]))
      for (const r of (skupinyRaw ?? []) as any[]) {
        const arr = tridyByBlok.get(r.blok_id) ?? []
        arr.push(groupName.get(r.group_id) ?? '?')
        tridyByBlok.set(r.blok_id, arr)
        if (!firstGroupByBlok.has(r.blok_id)) firstGroupByBlok.set(r.blok_id, r.group_id)
      }
      for (const s of (staffRaw ?? []) as any[]) staffMap.set(s.id, `${s.first_name} ${s.last_name}`)
    }

    for (const o of myObs) {
      const b = blokyById.get(o.blok_id)
      if (!b) continue
      pocet++
      const mb: MujBlok = {
        id: b.id, datum: b.datum, cas_od: b.cas_od, cas_do: b.cas_do,
        nazev: b.nazev, typ_bloku: b.typ_bloku, stav: b.stav, potvrzeno_at: b.potvrzeno_at,
        pozice: o.pozice_na_bloku, je_suplovani: o.je_suplovani,
        supluje_za: o.supluje_za_staff_id ? staffMap.get(o.supluje_za_staff_id) ?? null : null,
        tridy: tridyByBlok.get(b.id) ?? [],
        kolize: false,
        groupId: firstGroupByBlok.get(b.id) ?? null,
      }
      const arr = byDatum.get(b.datum) ?? []
      arr.push(mb)
      byDatum.set(b.datum, arr)
    }
  }

  // Kontrola multiplicity: překryv vlastních (nezrušených) bloků ve dni
  let kolizeCelkem = 0
  for (const arr of byDatum.values()) {
    arr.sort((a, b) => a.cas_od.localeCompare(b.cas_od))
    const aktivni = arr.filter((b) => b.stav !== 'zruseno')
    for (let i = 0; i < aktivni.length; i++) {
      for (let j = i + 1; j < aktivni.length; j++) {
        if (aktivni[j].cas_od < aktivni[i].cas_do && aktivni[i].cas_od < aktivni[j].cas_do) {
          aktivni[i].kolize = true
          aktivni[j].kolize = true
        }
      }
    }
    kolizeCelkem += aktivni.filter((b) => b.kolize).length
  }

  const dny = [0, 1, 2, 3, 4].map((i) => addDaysStr(monday, i))
  const buildHref = (week: string) => `?week=${week}`

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Můj rozvrh</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">Bloky, kde jsi tento týden obsazen/a.</p>
      </div>

      {/* Navigace týdnů */}
      <div className="flex items-center gap-2">
        <Link href={buildHref(mondayOf(addDaysStr(monday, -7)))} className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-gray-300 dark:border-stone-700">←</Link>
        <span className="text-sm font-medium text-gray-800 dark:text-stone-200 min-w-[10rem] text-center">{weekLabel(monday)}</span>
        <Link href={buildHref(mondayOf(addDaysStr(monday, 7)))} className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-gray-300 dark:border-stone-700">→</Link>
        <Link href={buildHref(mondayOf(new Date().toISOString().slice(0, 10)))} className="ml-1 text-xs text-gray-400 hover:text-gray-600">dnes</Link>
      </div>

      {kolizeCelkem > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <span className="font-medium">Pozor:</span> máš {kolizeCelkem} {kolizeCelkem === 1 ? 'blok' : 'bloky/bloků'} s časovým překryvem — nemůžeš být na dvou místech naráz. Nahlas to prosím řediteli.
        </div>
      )}

      <div className="space-y-4">
        {dny.map((datum) => {
          const bloky = byDatum.get(datum) ?? []
          return (
            <div key={datum}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-stone-200 mb-2 capitalize">{formatDateCZ(datum)}</h3>
              {bloky.length === 0 ? (
                <p className="text-xs text-gray-400 pl-1">— volno —</p>
              ) : (
                <div className="space-y-2">
                  {bloky.map((b) => {
                    const zruseno = b.stav === 'zruseno'
                    return (
                      <div key={b.id} className={`rounded-xl border p-4 ${b.kolize ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40' : zruseno ? 'border-gray-200 bg-gray-50 dark:border-stone-800 dark:bg-stone-900/40' : 'border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-900'}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${zruseno ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-stone-100'}`}>{casHM(b.cas_od)}–{casHM(b.cas_do)}</span>
                          <span className={zruseno ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-stone-300'}>{b.nazev}</span>
                          {b.tridy.map((t) => (
                            <span key={t} className="inline-flex rounded-full bg-gray-900 px-2 py-0.5 text-xs text-white dark:bg-stone-100 dark:text-stone-900">Třída {t}</span>
                          ))}
                          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-stone-800 dark:text-stone-300">{TYP_BLOKU_LABEL[b.typ_bloku]}</span>
                          <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">{POZICE_LABEL[b.pozice]}</span>
                          {b.je_suplovani && <span className="text-xs text-amber-600">supluješ{b.supluje_za ? ` za ${b.supluje_za}` : ''}</span>}
                          {zruseno && <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">Zrušeno</span>}
                          {b.kolize && <span className="inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">⚠ překryv</span>}
                        </div>
                        {!zruseno && (
                          <div className="mt-2 flex items-center gap-3 text-xs">
                            {b.potvrzeno_at
                              ? <span className="font-medium text-emerald-600">✓ zapsáno v třídnici</span>
                              : <span className="text-amber-600">⚠ nezapsáno</span>}
                            {b.groupId && (
                              <Link href={`/dashboard/tridni-kniha/den?datum=${b.datum}&group=${b.groupId}`}
                                className="text-gray-500 underline underline-offset-2 hover:text-gray-800 dark:text-stone-400 dark:hover:text-stone-200">
                                {b.potvrzeno_at ? 'otevřít zápis' : 'zapsat do třídnice'}
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-400">Celkem {pocet} bloků tento týden. Zrušené bloky jsou přeškrtnuté.</p>
    </div>
  )
}
