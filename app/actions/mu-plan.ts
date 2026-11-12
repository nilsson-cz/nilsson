'use server'

// app/actions/mu-plan.ts
// Rozpočet (Manažerské účetnictví F4, migrace 156): uložení řádku plánu
// (činnost × kategorie × 12 měsíců okna), smazání řádku, kopie plánu z jiného okna.
// Zápis vynucuje RLS (is_director()); akce navíc ověřují roli ředitele.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { kopirovatPlan, navrhDotaci, oknoMesice, rozpocitat, type PlanSablona } from '@/lib/manazerske-ucetnictvi/plan'
import { loadVfReport } from '@/lib/verejne-finance'
import { parsePeriod } from '@/lib/vykaz-ku'

type Result = { ok?: true; error?: string }
const TYP = 'schvaleny'

async function director() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, ok: false }
  const { data } = await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
  return { supabase, ok: data?.role === 'director' }
}

function parseKc(raw: string): number | null | 'invalid' {
  const v = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 'invalid'
}

function revalidate() {
  revalidatePath('/dashboard/manazerske-ucetnictvi', 'layout')
  revalidatePath('/dashboard')
}

/**
 * Uloží řádek plánu pro okno (12 měsíců). Šablona '12'/'10' rozpočítá roční částku,
 * 'rucne' bere měsíční hodnoty. Měsíce s nulou se z plánu odstraní.
 */
export async function savePlanRadek(input: {
  okno: string
  cinnostId: string
  kategorieId: string
  sablona: PlanSablona
  rocni: string
  mesicne: string[]
}): Promise<Result> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  const mesice = oknoMesice(input.okno)
  if (!mesice) return { error: 'Neplatné období.' }
  if (!input.cinnostId || !input.kategorieId) return { error: 'Chybí činnost nebo kategorie.' }

  let hodnoty: number[]
  if (input.sablona === 'rucne') {
    if (input.mesicne.length !== 12) return { error: 'Chybí měsíční hodnoty.' }
    const parsed = input.mesicne.map(parseKc)
    if (parsed.some((v) => v === 'invalid')) return { error: 'Částky zadejte jako nezáporná čísla.' }
    hodnoty = parsed.map((v) => (v === 'invalid' || v === null ? 0 : v))
  } else {
    const rocni = parseKc(input.rocni)
    if (rocni === 'invalid') return { error: 'Roční částku zadejte jako nezáporné číslo.' }
    hodnoty = rozpocitat(rocni ?? 0, mesice, input.sablona)
  }

  const now = new Date().toISOString()
  const upsert = mesice.flatMap((period, i) => (hodnoty[i] > 0
    ? [{ typ: TYP, period, cinnost_id: input.cinnostId, kategorie_id: input.kategorieId, castka: hodnoty[i], updated_at: now }]
    : []))
  const nuly = mesice.filter((_, i) => !(hodnoty[i] > 0))

  // Kategorie podpůrných opatření patří jen činnosti PO (smazat starý řádek jinde jde dál).
  if (upsert.length > 0) {
    const [{ data: cin }, { data: kat }] = await Promise.all([
      supabase.from('mu_cinnost').select('kod').eq('id', input.cinnostId).maybeSingle(),
      supabase.from('mu_kategorie').select('kod').eq('id', input.kategorieId).maybeSingle(),
    ])
    if (kat && /^(dotace|mzdy)_po(_|$)/.test(kat.kod) && cin?.kod !== 'po') {
      return { error: 'Kategorie podpůrných opatření patří jen činnosti Podpůrná opatření.' }
    }
  }

  if (upsert.length > 0) {
    const { error } = await supabase.from('mu_plan').upsert(upsert, { onConflict: 'typ,period,cinnost_id,kategorie_id' })
    if (error) return { error: error.message }
  }
  if (nuly.length > 0) {
    const { error } = await supabase.from('mu_plan').delete()
      .eq('typ', TYP).eq('cinnost_id', input.cinnostId).eq('kategorie_id', input.kategorieId).in('period', nuly)
    if (error) return { error: error.message }
  }
  revalidate()
  return { ok: true }
}

export async function deletePlanRadek(input: { okno: string; cinnostId: string; kategorieId: string }): Promise<Result> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  const mesice = oknoMesice(input.okno)
  if (!mesice) return { error: 'Neplatné období.' }
  const { error } = await supabase.from('mu_plan').delete()
    .eq('typ', TYP).eq('cinnost_id', input.cinnostId).eq('kategorie_id', input.kategorieId).in('period', mesice)
  if (error) return { error: error.message }
  revalidate()
  return { ok: true }
}

/**
 * Navrhne dotační řádky rozpočtu pro okno z nároku Veřejných financí (navrhDotaci):
 * do aktuálního měsíce skutečný nárok, dál nárok aktuálního měsíce. Zapíše se do činností
 * a kategorií podle mapování dotací; přepíše jen tyto dotační řádky v okně.
 */
export async function navrhnoutDotaceZVf(okno: string): Promise<Result & { radku?: number; celkem?: number }> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  const mesice = oknoMesice(okno)
  if (!mesice) return { error: 'Neplatné období.' }
  const now = new Date()
  const aktualni = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Nárok za měsíce okna do aktuálního + aktuální měsíc (základ pro budoucí měsíce).
  const vfMesice = [...new Set([...mesice.filter((p) => p <= aktualni), aktualni])].sort()
  let vf
  try {
    vf = await loadVfReport(supabase, vfMesice.map(parsePeriod))
  } catch (e) {
    return { error: `Veřejné finance nejsou dostupné: ${(e as Error).message}` }
  }
  const narok = [...vf.res.cells.values()].map((c) => ({ period: c.period, polozkaId: c.polozkaId, narok: c.narok }))

  // Mapování položek: činnost + kategorie (bez mapování Škola / Dotace).
  const [{ data: map }, { data: kat }, { data: cin }] = await Promise.all([
    supabase.from('mu_vf_polozka_cinnost').select('*'),
    supabase.from('mu_kategorie').select('id, kod'),
    supabase.from('mu_cinnost').select('id, kod'),
  ])
  const dotaceKat = (kat ?? []).find((k) => k.kod === 'dotace')?.id
  const skola = (cin ?? []).find((c) => c.kod === 'skola')?.id
  const mapBy = new Map((map ?? []).map((m) => [m.polozka_id, m]))
  const mapa = new Map<string, { cinnostId: string; kategorieId: string }>()
  for (const p of vf.params.polozky.filter((x) => x.aktivni)) {
    const m = mapBy.get(p.id)
    const cinnostId = m?.cinnost_id ?? skola
    const kategorieId = m?.kategorie_id ?? dotaceKat
    if (cinnostId && kategorieId) mapa.set(p.id, { cinnostId, kategorieId })
  }

  const bunky = navrhDotaci(mesice, aktualni, narok, mapa)
  if (bunky.length === 0) return { error: 'Veřejné finance za toto období nevracejí žádný nárok — zkontrolujte normativy a koeficienty.' }

  const cile = [...new Set([...mapa.values()].map((c) => `${c.cinnostId}|${c.kategorieId}`))]
  for (const c of cile) {
    const [cinnostId, kategorieId] = c.split('|')
    const { error } = await supabase.from('mu_plan').delete()
      .eq('typ', TYP).eq('cinnost_id', cinnostId).eq('kategorie_id', kategorieId).in('period', mesice)
    if (error) return { error: error.message }
  }
  const now2 = new Date().toISOString()
  const { error } = await supabase.from('mu_plan').insert(bunky.map((b) => ({
    typ: TYP, period: b.period, cinnost_id: b.cinnostId, kategorie_id: b.kategorieId, castka: b.castka, updated_at: now2,
  })))
  if (error) return { error: error.message }
  revalidate()
  return { ok: true, radku: bunky.length, celkem: Math.round(bunky.reduce((s, b) => s + b.castka, 0)) }
}

/**
 * Zkopíruje plán z okna `z` do okna `do` stejného druhu (kalendářní → kalendářní, školní → školní)
 * s navýšením v procentech. Cílové okno musí být prázdné, pokud není `prepsat`.
 */
export async function kopirovatPlanOkno(input: { z: string; do: string; navyseniPct: string; prepsat: boolean }): Promise<Result & { radku?: number }> {
  const { supabase, ok } = await director()
  if (!ok) return { error: 'Pouze ředitel.' }
  const zM = oknoMesice(input.z)
  const doM = oknoMesice(input.do)
  if (!zM || !doM || input.z.includes('/') !== input.do.includes('/')) return { error: 'Neplatná období (obě musí být kalendářní, nebo obě školní rok).' }
  const pct = Number(input.navyseniPct.trim().replace(',', '.') || '0')
  if (!Number.isFinite(pct) || pct < -100 || pct > 1000) return { error: 'Navýšení zadejte v procentech (např. 5).' }

  const { data: cil, error: cErr } = await supabase.from('mu_plan').select('period').eq('typ', TYP).in('period', doM).limit(1)
  if (cErr) return { error: cErr.message }
  if ((cil ?? []).length > 0 && !input.prepsat) return { error: 'Cílové období už má rozpočet. Potvrďte přepsání.' }

  const { data: zdroj, error: zErr } = await supabase.from('mu_plan')
    .select('period, cinnost_id, kategorie_id, castka').eq('typ', TYP).in('period', zM)
  if (zErr) return { error: zErr.message }
  if (!zdroj || zdroj.length === 0) return { error: 'Zdrojové období nemá žádný rozpočet.' }

  const posun = Number(doM[0].slice(0, 4)) - Number(zM[0].slice(0, 4))
  const nove = kopirovatPlan(
    zdroj.map((r) => ({ period: r.period, cinnostId: r.cinnost_id, kategorieId: r.kategorie_id, castka: Number(r.castka) })),
    posun, pct,
  )

  if (input.prepsat) {
    const { error } = await supabase.from('mu_plan').delete().eq('typ', TYP).in('period', doM)
    if (error) return { error: error.message }
  }
  const now = new Date().toISOString()
  const { error } = await supabase.from('mu_plan').upsert(
    nove.filter((b) => b.castka > 0).map((b) => ({
      typ: TYP, period: b.period, cinnost_id: b.cinnostId, kategorie_id: b.kategorieId, castka: b.castka, updated_at: now,
    })),
    { onConflict: 'typ,period,cinnost_id,kategorie_id' },
  )
  if (error) return { error: error.message }
  revalidate()
  return { ok: true, radku: nove.length }
}
