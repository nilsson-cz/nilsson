/**
 * lib/potvrzeni-o-studiu/gather.ts
 *
 * Data pro „Potvrzení o studiu", které si rodič generuje v portálu.
 *
 * Bezpečnost: rodič nemá RLS SELECT na groups / group_memberships / addresses
 * (viz migrace 164), proto data čteme service-role klientem — ALE až poté, co
 * běžným (RLS) klientem ověříme, že přihlášený uživatel je zákonným zástupcem
 * žáka (aktivní vazba, je_zakonny_zastupce) a žák do školy chodí. Admin klient
 * čte jen pevně dané sloupce jednoho žáka, nic dalšího.
 */

import 'server-only'
import { createSupabaseAdmin, createSupabaseServerClient } from '@/lib/supabase-server'
import { isAttending } from '@/lib/portal-children'
import { getActiveSchoolYear } from '@/lib/school-year'
import { getStudentAddresses, formatAddressLine } from '@/lib/addresses'
import { RASD, type ParagrafPsd } from '@/lib/zpusob-psd'
import type { PotvrzeniData } from './pdf'

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type PortalChild = { id: string; first_name: string; last_name: string }

/** Děti, pro které smí přihlášený rodič potvrzení vystavit (ZZ + docházející). */
export async function getChildrenForPotvrzeni(supabase: ServerClient): Promise<PortalChild[] | null> {
  return (await getGuardianChildren(supabase))?.children ?? null
}

async function getGuardianChildren(
  supabase: ServerClient,
): Promise<{ guardianId: string; children: PortalChild[] } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: guardian } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!guardian) return null

  const { data: links } = await supabase
    .from('student_guardian_links')
    .select('students ( id, first_name, last_name, status, withdrawal_date )')
    .eq('guardian_id', guardian.id)
    .eq('je_zakonny_zastupce', true)
    .is('platnost_do', null)

  type Row = { students: (PortalChild & { status: string; withdrawal_date: string | null }) | null }
  const children = ((links as Row[] | null) ?? [])
    .map((l) => l.students)
    .filter((s): s is NonNullable<Row['students']> => !!s && isAttending(s))
    .map(({ id, first_name, last_name }) => ({ id, first_name, last_name }))
    .sort((a, b) => a.last_name.localeCompare(b.last_name, 'cs'))
  return { guardianId: guardian.id, children }
}

/** Pohlaví z rodného čísla (ženy mají k měsíci +50, příp. +70). */
function zenaZRodnehoCisla(rc: string | null): boolean | null {
  const digits = rc?.replace(/\D/g, '') ?? ''
  if (digits.length < 9) return null
  const mm = parseInt(digits.slice(2, 4), 10)
  if (Number.isNaN(mm)) return null
  return mm > 50
}

function vekKDatu(birthIso: string, refIso: string): number {
  const b = new Date(birthIso)
  const r = new Date(refIso)
  let age = r.getFullYear() - b.getFullYear()
  const m = r.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && r.getDate() < b.getDate())) age--
  return age
}

export type GatherResult =
  | { ok: true; data: PotvrzeniData; jmenoSoubor: { first: string; last: string }; guardianId: string }
  | { ok: false; status: number; error: string }

export async function gatherPotvrzeni(
  supabase: ServerClient,
  studentId: string,
  opts: { ucel: string | null; uvestRc: boolean },
): Promise<GatherResult> {
  // 1) Autorizace běžným klientem (RLS).
  const g = await getGuardianChildren(supabase)
  if (g === null) return { ok: false, status: 401, error: 'Nejste přihlášeni jako zákonný zástupce.' }
  if (!g.children.some((c) => c.id === studentId)) {
    return { ok: false, status: 403, error: 'K tomuto žákovi nemáte oprávnění vystavit potvrzení.' }
  }

  // 2) Čtení dat service-role klientem (jen tento žák).
  const admin = createSupabaseAdmin()
  const dnes = new Date().toISOString().slice(0, 10)

  const { data: s } = await admin
    .from('students')
    .select('first_name, last_name, birth_date, birth_number, enrollment_date')
    .eq('id', studentId)
    .maybeSingle()
  if (!s) return { ok: false, status: 404, error: 'Žák nenalezen.' }

  // Bydliště: jednotný adresní model, fallback přijímací žádost.
  const addr = await getStudentAddresses(admin, studentId)
  let bydliste = formatAddressLine(addr.trvale)
  if (!bydliste) {
    const { data: app } = await admin
      .from('enrollment_applications')
      .select('dite_trvale_bydliste_ulice, dite_trvale_bydliste_cislo, dite_trvale_bydliste_psc, dite_trvale_bydliste_obec')
      .eq('student_id', studentId)
      .maybeSingle()
    if (app) {
      const r1 = [app.dite_trvale_bydliste_ulice, app.dite_trvale_bydliste_cislo].filter(Boolean).join(' ')
      const r2 = [app.dite_trvale_bydliste_psc, app.dite_trvale_bydliste_obec].filter(Boolean).join(' ')
      bydliste = [r1, r2].filter((p) => p.length > 0).join(', ') || null
    }
  }

  // Školní rok + třída (aktivní členství v aktivním roce; jinak nejnovější).
  const aktivniRok = await getActiveSchoolYear()
  const { data: mems } = await admin
    .from('group_memberships')
    .select('school_year, group_id, valid_to')
    .eq('student_id', studentId)
    .order('valid_from', { ascending: false })
  const memberships = (mems ?? []).filter((m) => !m.valid_to || m.valid_to >= dnes)
  const vRoce = memberships.filter((m) => m.school_year === aktivniRok)
  const vybrane = vRoce.length > 0 ? vRoce : memberships.slice(0, 1)
  const skolniRok = vybrane[0]?.school_year ?? aktivniRok
  let trida: string | null = null
  if (vybrane.length > 0) {
    const { data: groups } = await admin
      .from('groups')
      .select('name')
      .in('id', vybrane.map((m) => m.group_id))
    trida = (groups ?? []).map((g) => g.name).join(', ') || null
  }

  // Ročník + způsob plnění PŠD k dnešku (matrika).
  const { data: edu } = await admin
    .from('student_education_mode')
    .select('rocnik, zpusob')
    .eq('student_id', studentId)
    .lte('valid_from', dnes)
    .or(`valid_to.is.null,valid_to.gte.${dnes}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  const paragraf: ParagrafPsd = (edu?.zpusob && RASD[edu.zpusob]?.paragraf) || '36'

  const data: PotvrzeniData = {
    zak: {
      jmeno: `${s.first_name} ${s.last_name}`.trim(),
      datum_narozeni: s.birth_date,
      rodne_cislo: opts.uvestRc ? s.birth_number : null,
      bydliste,
      zena: zenaZRodnehoCisla(s.birth_number),
      od: s.enrollment_date,
    },
    skolni_rok: skolniRok,
    trida,
    rocnik: edu?.rocnik ?? null,
    paragraf,
    pripravaNaPovolani: s.birth_date ? vekKDatu(s.birth_date, dnes) >= 15 : false,
    ucel: opts.ucel,
    datum_vydani: dnes,
    overeni: null,
    podpis: null,
    razitko: null,
  }

  return { ok: true, data, jmenoSoubor: { first: s.first_name, last: s.last_name }, guardianId: g.guardianId }
}
