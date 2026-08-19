// lib/enrollment/dashboard-queries.ts
// Server-side query helpery pro ředitelský pohled (/dashboard/zapis).
// Čte přes běžný RLS klient — enrollment_app_staff_read /
// enrollment_guardians_staff_all (migrace 037) povolují SELECT
// director/guide/assistant/vp; stránky samotné navíc gatují jen na
// director (viz page.tsx), ale RLS je širší, kdyby se gate v budoucnu
// uvolnil.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { EnrollmentStav, EnrollmentTyp } from './types'

// ── Odvození "roku zápisu" z data podání ────────────────────────────────
// Zrcadlí odvodRokZapisu() v app/actions/enrollment.ts, ale počítá se
// z libovolného data (created_at žádosti), ne jen z "teď". Nutné, protože
// enrollment_applications rok_zapisu jako sloupec nemá (viz konverzace).
// Konvence: podání v září a později cílí na příští kalendářní rok.
export function odvodRokZapisuZDatumu(datum: string | Date): number {
  const d = typeof datum === 'string' ? new Date(datum) : datum
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear()
}

export function aktualniRokZapisu(): number {
  return odvodRokZapisuZDatumu(new Date())
}

// ── Typy ─────────────────────────────────────────────────────────────────

export interface EnrollmentListRow {
  id: string
  typ: EnrollmentTyp
  stav: EnrollmentStav
  dite_jmeno: string
  dite_prijmeni: string
  datum_narozeni: string
  created_at: string
  spis_id: string | null
  rok_zapisu: number
  vlastnik_jmeno: string | null
}

export interface EnrollmentListFilters {
  stav?: EnrollmentStav | 'all'
  typ?: EnrollmentTyp | 'all'
  rokZapisu?: number | 'all'
}

export interface EnrollmentApplicationDetail {
  id: string
  typ: EnrollmentTyp
  stav: EnrollmentStav
  spis_id: string | null
  student_id: string | null
  migrated_at: string | null

  dite_jmeno: string
  dite_prijmeni: string
  rodne_cislo: string | null
  datum_narozeni: string
  misto_narozeni: string | null
  statni_obcanstvi: string | null
  pohlavi: string | null

  dite_trvale_bydliste_obec: string
  dite_trvale_bydliste_ulice: string | null
  dite_trvale_bydliste_cislo: string
  dite_trvale_bydliste_psc: string
  dite_bydli_jinde: boolean
  dite_kontaktni_adresa_obec: string | null
  dite_kontaktni_adresa_ulice: string | null
  dite_kontaktni_adresa_cislo: string | null
  dite_kontaktni_adresa_psc: string | null

  zdravotni_pojistovna: string | null
  lekar: string | null
  melo_odklad: boolean
  zdravotni_omezeni: string | null
  dalsi_informace: string | null
  dosavadni_skola: string | null
  specificke_potreby: string
  budouci_rocnik: number | null

  vekova_kategorie: string | null
  vyzaduje_ppp: boolean
  vyzaduje_lekare: boolean
  vyzaduje_specialistu: boolean
  odklad_rezim: string | null
  odklad_ppp_stav: string
  odklad_lekar_stav: string

  prestup_k_datu: string | null
  soucasna_skola: string | null
  soucasna_trida: string | null
  individualni_vzdelavani: boolean | null
  prestup_doporuceni_stav: string | null

  created_at: string
}

export interface EnrollmentGuardianRow {
  id: string
  role_v_zadosti: 'vlastnik' | 'spoluzastupce'
  first_name: string | null
  last_name: string | null
  email: string
  telefon: string | null
  pribuzensky_vztah: string | null
  stav: string
  poradi: number
}

export interface EnrollmentDecisionRow {
  id: number
  rozhodnuti: string
  duvod: string | null
  cilovy_school_year: string | null
  datum_nastupu: string | null
  created_at: string
}

// ── Seznam žádostí ───────────────────────────────────────────────────────

export async function getEnrollmentApplications(
  filters: EnrollmentListFilters = {}
): Promise<EnrollmentListRow[]> {
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('enrollment_applications')
    .select(
      'id, typ, stav, dite_jmeno, dite_prijmeni, datum_narozeni, created_at, spis_id'
    )
    .order('created_at', { ascending: false })

  if (filters.stav && filters.stav !== 'all') {
    query = query.eq('stav', filters.stav)
  }
  if (filters.typ && filters.typ !== 'all') {
    query = query.eq('typ', filters.typ)
  }

  const { data, error } = await query
  if (error || !data) return []

  let rows = (data as any[]).map((r) => ({
    ...r,
    rok_zapisu: odvodRokZapisuZDatumu(r.created_at as string),
    vlastnik_jmeno: null as string | null,
  })) as EnrollmentListRow[]

  if (filters.rokZapisu && filters.rokZapisu !== 'all') {
    rows = rows.filter((r) => r.rok_zapisu === filters.rokZapisu)
  }

  // Vlastník (jméno) — dotažení v druhém kroku, jen pro zobrazené řádky.
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id)
    const { data: guardians } = await supabase
      .from('enrollment_guardians')
      .select('application_id, first_name, last_name')
      .in('application_id', ids)
      .eq('role_v_zadosti', 'vlastnik')

    const byApp = new Map<string, string>()
    for (const g of (guardians as any[]) ?? []) {
      byApp.set(
        g.application_id,
        [g.first_name, g.last_name].filter(Boolean).join(' ')
      )
    }
    rows = rows.map((r) => ({ ...r, vlastnik_jmeno: byApp.get(r.id) ?? null }))
  }

  return rows
}

// Počet žádostí čekajících na rozhodnutí — pro AlertsWidget na /dashboard.
export async function getEnrollmentPendingDecisionCount(): Promise<number> {
  const supabase = await createSupabaseServerClient()
  const { count } = await supabase
    .from('enrollment_applications')
    .select('*', { count: 'exact', head: true })
    .eq('stav', 'k_rozhodnuti')
  return count ?? 0
}

// ── Detail jedné žádosti ─────────────────────────────────────────────────

export async function getEnrollmentApplicationDetail(
  id: string
): Promise<EnrollmentApplicationDetail | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('enrollment_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return (data as any) ?? null
}

export async function getEnrollmentGuardians(
  applicationId: string
): Promise<EnrollmentGuardianRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('enrollment_guardians')
    .select(
      'id, role_v_zadosti, first_name, last_name, email, telefon, pribuzensky_vztah, stav, poradi'
    )
    .eq('application_id', applicationId)
    .order('poradi', { ascending: true })
  return (data as any) ?? []
}

export async function getEnrollmentDecisions(
  applicationId: string
): Promise<EnrollmentDecisionRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('enrollment_decisions')
    .select('id, rozhodnuti, duvod, cilovy_school_year, datum_nastupu, created_at')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })
  return (data as any) ?? []
}

export interface EnrollmentSettingsRow {
  zapis_otevren: boolean
  okno_od: string | null
  okno_do: string | null
}

export async function getEnrollmentSettings(): Promise<EnrollmentSettingsRow> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('enrollment_settings')
    .select('zapis_otevren, okno_od, okno_do')
    .eq('id', 1)
    .maybeSingle()
  return (data as any) ?? { zapis_otevren: false, okno_od: null, okno_do: null }
}

// ── CSV export dat (jméno dítěte + kontakt primárního zástupce) ─────────

export interface EnrollmentCsvRow {
  dite_jmeno: string
  dite_prijmeni: string
  datum_narozeni: string
  typ: EnrollmentTyp
  stav: EnrollmentStav
  vlastnik_jmeno: string
  vlastnik_email: string
  vlastnik_telefon: string
}

export async function getEnrollmentCsvData(
  rokZapisu: number
): Promise<EnrollmentCsvRow[]> {
  const supabase = await createSupabaseServerClient()

  const { data: apps } = await supabase
    .from('enrollment_applications')
    .select('id, typ, stav, dite_jmeno, dite_prijmeni, datum_narozeni, created_at')
    .order('created_at', { ascending: false })

  const filtered = ((apps as any[]) ?? []).filter(
    (a) => odvodRokZapisuZDatumu(a.created_at) === rokZapisu
  )
  if (filtered.length === 0) return []

  const ids = filtered.map((a) => a.id)
  const { data: guardians } = await supabase
    .from('enrollment_guardians')
    .select('application_id, first_name, last_name, email, telefon')
    .in('application_id', ids)
    .eq('role_v_zadosti', 'vlastnik')

  const byApp = new Map<string, any>()
  for (const g of (guardians as any[]) ?? []) {
    byApp.set(g.application_id, g)
  }

  return filtered.map((a) => {
    const g = byApp.get(a.id)
    return {
      dite_jmeno: a.dite_jmeno,
      dite_prijmeni: a.dite_prijmeni,
      datum_narozeni: a.datum_narozeni,
      typ: a.typ,
      stav: a.stav,
      vlastnik_jmeno: g ? [g.first_name, g.last_name].filter(Boolean).join(' ') : '',
      vlastnik_email: g?.email ?? '',
      vlastnik_telefon: g?.telefon ?? '',
    }
  })
}
