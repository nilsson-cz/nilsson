/**
 * app/dashboard/tridni-kniha/den/page.tsx
 * Server Component — denní stránka třídnice řízená rozvrhem.
 * Zobrazí naplánované bloky dne pro třídu (z rozvrhu, předvyplněné) a umožní je
 * zapsat/potvrdit po blocích (Fáze „třídnice po blocích", 2026-08-02).
 * Den zůstává jedním kontejnerovým tridni_kniha_zaznamy (SVP/typ/legislativa);
 * obsah bloku žije na rozvrh_blok.obsah. Zapisovat smí obsazený nebo ředitel.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config'
import { formatDateCZ } from '@/lib/tridni-kniha-missing'
import { addDaysStr, type TypBloku } from '@/lib/rozvrh-shared'
import DenBlokZapis, { type ZapisObsazeni, type PriznakTyp, type BlokPriznak, type StaffOption } from './_components/DenBlokZapis'

export const metadata = { title: 'Třídnice — zápis dne | IS Nilsson' }

type Group = { id: string; name: string }

/** Posun na předchozí/další pracovní den (přeskočí So/Ne). */
function shiftWorkday(dateStr: string, dir: 1 | -1): string {
  let d = addDaysStr(dateStr, dir)
  for (let i = 0; i < 6; i++) {
    const dow = new Date(`${d}T12:00:00`).getDay()
    if (dow !== 0 && dow !== 6) break
    d = addDaysStr(d, dir)
  }
  return d
}

export default async function TridniceDenPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string; group?: string; datum?: string }>
}) {
  const sp = await searchParams
  const schoolYear = sp.rok && SCHOOL_YEAR_OPTIONS.includes(sp.rok) ? sp.rok : CURRENT_SCHOOL_YEAR
  const datum = sp.datum && /^\d{4}-\d{2}-\d{2}$/.test(sp.datum) ? sp.datum : new Date().toISOString().slice(0, 10)

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('id, role').eq('user_id', user!.id).maybeSingle()
  const myId = (me as { id: string; role?: string } | null)?.id ?? null
  const isDirector = (me as { role?: string } | null)?.role === 'director'

  const { data: groupsRaw } = await supabase
    .from('groups').select('id, name').eq('school_year', schoolYear).order('name')
  const groups = (groupsRaw ?? []) as Group[]
  const selectedGroupId = (sp.group && groups.find((g) => g.id === sp.group)?.id) || groups[0]?.id || null

  const { data: staffRawList } = await supabase.from('staff').select('id, first_name, last_name')
  const staffMap = new Map<string, string>(((staffRawList ?? []) as any[]).map((s) => [s.id, `${s.first_name} ${s.last_name}`]))
  const staffOptions: StaffOption[] = ((staffRawList ?? []) as any[])
    .map((s) => ({ id: s.id as string, jmeno: `${s.first_name} ${s.last_name}` }))
    .sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs'))

  // Aktivní typy příznaků (číselník) — společné pro všechny bloky dne.
  const { data: typyRaw } = await supabase
    .from('tridnice_priznak_typ')
    .select('kod, nazev, ikona, ma_osobu, ma_poznamku')
    .eq('aktivni', true)
    .order('poradi')
  const priznakTypy = (typyRaw ?? []) as PriznakTyp[]

  type Blok = {
    id: string; cas_od: string; cas_do: string; nazev: string; typ_bloku: TypBloku
    obsah: string | null; potvrzeno_at: string | null
    obsazeni: ZapisObsazeni[]; canWrite: boolean; priznaky: BlokPriznak[]
  }
  let bloky: Blok[] = []
  let containerId: string | null = null

  if (selectedGroupId) {
    const { data: blokyRaw } = await supabase
      .from('rozvrh_blok')
      .select('id, cas_od, cas_do, nazev, typ_bloku, stav, potvrzeno_at, obsah')
      .eq('datum', datum).order('cas_od')
    const all = (blokyRaw ?? []) as any[]
    const blokIds = all.map((b) => b.id)

    let groupSet = new Set<string>()
    const obsByBlok = new Map<string, ZapisObsazeni[]>()
    const priznakyByBlok = new Map<string, BlokPriznak[]>()
    const mineBlok = new Set<string>()
    if (blokIds.length > 0) {
      const [{ data: skupinyRaw }, { data: obsRaw }, { data: priznakyRaw }] = await Promise.all([
        supabase.from('rozvrh_blok_skupiny').select('blok_id, group_id').in('blok_id', blokIds).eq('group_id', selectedGroupId),
        supabase.from('rozvrh_obsazeni').select('blok_id, staff_id, zapocitat_ppc').in('blok_id', blokIds),
        supabase.from('rozvrh_blok_priznak').select('blok_id, typ_kod, osoba_staff_id, poznamka').in('blok_id', blokIds),
      ])
      groupSet = new Set<string>(((skupinyRaw ?? []) as any[]).map((r) => r.blok_id))
      for (const o of (obsRaw ?? []) as any[]) {
        const arr = obsByBlok.get(o.blok_id) ?? []
        arr.push({ staff_id: o.staff_id, jmeno: staffMap.get(o.staff_id) ?? 'Neznámý', zapocitat_ppc: o.zapocitat_ppc })
        obsByBlok.set(o.blok_id, arr)
        if (myId && o.staff_id === myId) mineBlok.add(o.blok_id)
      }
      for (const p of (priznakyRaw ?? []) as any[]) {
        const arr = priznakyByBlok.get(p.blok_id) ?? []
        arr.push({ typ_kod: p.typ_kod, osoba_staff_id: p.osoba_staff_id ?? null, poznamka: p.poznamka ?? null })
        priznakyByBlok.set(p.blok_id, arr)
      }
    }

    bloky = all
      .filter((b) => groupSet.has(b.id) && b.stav !== 'zruseno')
      .map((b) => ({
        id: b.id, cas_od: b.cas_od, cas_do: b.cas_do, nazev: b.nazev, typ_bloku: b.typ_bloku as TypBloku,
        obsah: b.obsah ?? null, potvrzeno_at: b.potvrzeno_at ?? null,
        obsazeni: obsByBlok.get(b.id) ?? [],
        canWrite: isDirector || mineBlok.has(b.id),
        priznaky: priznakyByBlok.get(b.id) ?? [],
      }))

    const { data: contRaw } = await supabase
      .from('tridni_kniha_zaznamy').select('id').eq('datum', datum).eq('group_id', selectedGroupId)
      .order('created_at').limit(1)
    containerId = ((contRaw ?? []) as any[])[0]?.id ?? null
  }

  const buildHref = (p: { rok?: string; group?: string; datum?: string }) => {
    const u = new URLSearchParams()
    u.set('rok', p.rok ?? schoolYear)
    if (p.group ?? selectedGroupId) u.set('group', (p.group ?? selectedGroupId)!)
    u.set('datum', p.datum ?? datum)
    return `?${u.toString()}`
  }

  const zapsano = bloky.filter((b) => b.potvrzeno_at).length

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/tridni-kniha" className="text-sm text-gray-400 hover:text-gray-600">← Třídní kniha</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Zápis dne</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">Bloky dne z rozvrhu — odškrtni přítomnost a stručně zapiš, co se dělo.</p>
      </div>

      {/* Třídy */}
      {groups.length > 1 && (
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
      )}

      {/* Navigace dnů */}
      <div className="flex items-center gap-2">
        <Link href={buildHref({ datum: shiftWorkday(datum, -1) })} className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-gray-300 dark:border-stone-700">←</Link>
        <span className="text-sm font-medium text-gray-800 dark:text-stone-200 min-w-[14rem] text-center capitalize">{formatDateCZ(datum)}</span>
        <Link href={buildHref({ datum: shiftWorkday(datum, 1) })} className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-gray-300 dark:border-stone-700">→</Link>
        <Link href={buildHref({ datum: new Date().toISOString().slice(0, 10) })} className="ml-1 text-xs text-gray-400 hover:text-gray-600">dnes</Link>
      </div>

      {/* Kontejnerový denní záznam (SVP / typ / legislativa) */}
      {containerId ? (
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
          Denní záznam třídnice existuje —{' '}
          <Link href={`/dashboard/tridni-kniha/${containerId}`} className="font-medium text-gray-700 underline underline-offset-2 dark:text-stone-200">otevřít (typ, SVP vazby)</Link>
        </div>
      ) : (
        bloky.length > 0 && (
          <p className="text-xs text-gray-400">Denní záznam třídnice vznikne po prvním potvrzení bloku.</p>
        )
      )}

      {/* Bloky */}
      {!selectedGroupId ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">Pro školní rok {schoolYear} nejsou třídy.</div>
      ) : bloky.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Pro tento den nejsou naplánované bloky.{' '}
          <Link href={`/dashboard/tridni-kniha/novy`} className="text-gray-700 underline underline-offset-2 dark:text-stone-200">Zapsat ručně</Link>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{zapsano}/{bloky.length} bloků zapsáno</span>
          </div>
          <div className="space-y-3">
            {bloky.map((b) => (
              <DenBlokZapis
                key={b.id}
                blokId={b.id}
                nazev={b.nazev}
                casOd={b.cas_od}
                casDo={b.cas_do}
                typBloku={b.typ_bloku}
                obsahDefault={b.obsah ?? ''}
                obsazeni={b.obsazeni}
                potvrzeno={Boolean(b.potvrzeno_at)}
                canWrite={b.canWrite}
                priznakTypy={priznakTypy}
                priznaky={b.priznaky}
                staffOptions={staffOptions}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
