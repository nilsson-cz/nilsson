'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { notifyDiscord } from '@/lib/discord'
import { sendGuardianInvite } from '@/lib/enrollment/send-guardian-invite'
import type {
  EnrollmentTyp,
  ValidaceAdresyVysledek,
  VekovaKlasifikace,
  EnrollmentSpecifickePotreby,
  EnrollmentPrestupDoporuceni,
} from '@/lib/enrollment/types'

// ---------------------------------------------------------------------------
// Výsledkové typy
// ---------------------------------------------------------------------------

export type EnrollmentResult<T = void> =
  | ({ success: true } & ([T] extends [void] ? {} : { data: T }))
  | { success: false; error: string }

async function requireUser() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

// ---------------------------------------------------------------------------
// Odvození roku zápisu ze settings (okno_od), fallback dle aktuálního data.
// rok_zapisu = kalendářní rok toho září, do kterého dítě nastupuje.
// ---------------------------------------------------------------------------

async function odvodRokZapisu(supabase: any): Promise<number> {
  const { data } = await supabase
    .from('enrollment_settings')
    .select('okno_od')
    .eq('id', 1)
    .maybeSingle()

  if (data?.okno_od) {
    return new Date(data.okno_od as string).getFullYear()
  }
  const now = new Date()
  // Po zahájení šk. roku (září+) míří zápis na příští rok.
  return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear()
}

// ---------------------------------------------------------------------------
// 1) Založení nové žádosti — bootstrap RPC (migrace 043)
// ---------------------------------------------------------------------------

export async function createEnrollmentApplication(
  typ: EnrollmentTyp
): Promise<EnrollmentResult<{ id: string }>> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data, error } = await supabase.rpc(
    'enrollment_create_application',
    { p_typ: typ }
  )

  if (error) {
    // Otevírací okno zavřené → srozumitelná hláška
    if (error.message?.includes('zápis není otevřený')) {
      return { success: false, error: 'Zápis aktuálně není otevřený.' }
    }
    return { success: false, error: 'Nepodařilo se založit žádost. Zkuste to znovu.' }
  }

  revalidatePath('/zapis')
  return { success: true, data: { id: data as string } }
}

// ---------------------------------------------------------------------------
// 2) RÚIAN validace adresy (enrollment_validate_address, migrace 041)
// ---------------------------------------------------------------------------

export async function validateEnrollmentAddress(input: {
  obec: string
  ulice?: string | null
  cislo: string
  psc?: string | null
}): Promise<EnrollmentResult<ValidaceAdresyVysledek>> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data, error } = await supabase.rpc(
    'enrollment_validate_address',
    {
      p_obec: input.obec?.trim() ?? '',
      p_ulice: input.ulice?.trim() ?? '',
      p_cislo: input.cislo?.trim() ?? '',
      p_psc: input.psc?.trim() ?? '',
    }
  )

  if (error) {
    return { success: false, error: 'Ověření adresy selhalo. Zkuste to znovu.' }
  }

  return { success: true, data: data as ValidaceAdresyVysledek }
}

// ---------------------------------------------------------------------------
// 3) Věková klasifikace (enrollment_classify_age, migrace 037)
// ---------------------------------------------------------------------------

export async function classifyEnrollmentAge(input: {
  datum_narozeni: string
  melo_odklad: boolean
}): Promise<EnrollmentResult<VekovaKlasifikace>> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const rokZapisu = await odvodRokZapisu(supabase)
  const skolniRokZacatek = `${rokZapisu}-09-01`

  const { data, error } = await supabase.rpc(
    'enrollment_classify_age',
    {
      p_datum_narozeni: input.datum_narozeni,
      p_melo_odklad: input.melo_odklad,
      p_rok_zapisu: rokZapisu,
      p_skolni_rok_zacatek: skolniRokZacatek,
    }
  )

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    return { success: false, error: 'Nepodařilo se vyhodnotit věk dítěte.' }
  }

  const row = data[0]
  return {
    success: true,
    data: {
      vekova_kategorie: row.vekova_kategorie,
      vyzaduje_ppp: row.vyzaduje_ppp,
      vyzaduje_lekare: row.vyzaduje_lekare,
      vyzaduje_specialistu: row.vyzaduje_specialistu,
      odklad_rezim: row.odklad_rezim,
    },
  }
}

// ---------------------------------------------------------------------------
// Pomocná: ověřit, že přihlášený je vlastníkem dané žádosti a že je
// žádost ještě editovatelná.
// ---------------------------------------------------------------------------

async function assertOwnerEditable(
  supabase: any,
  userId: string,
  appId: string
): Promise<{ ok: true; ownerGuardianId: string } | { ok: false; error: string }> {
  const { data: app } = await supabase
    .from('enrollment_applications')
    .select('id, stav')
    .eq('id', appId)
    .maybeSingle()

  if (!app) return { ok: false, error: 'Žádost nenalezena.' }

  const editovatelne = ['zalozena', 'ceka_na_spoluzastupce', 'dotaznik_rozpracovany']
  if (!editovatelne.includes(app.stav)) {
    return { ok: false, error: 'Žádost už byla odeslána a nelze ji upravovat.' }
  }

  const { data: owner } = await supabase
    .from('enrollment_guardians')
    .select('id')
    .eq('application_id', appId)
    .eq('auth_user_id', userId)
    .eq('role_v_zadosti', 'vlastnik')
    .maybeSingle()

  if (!owner) return { ok: false, error: 'K této žádosti nemáte oprávnění vlastníka.' }

  return { ok: true, ownerGuardianId: owner.id }
}

// ---------------------------------------------------------------------------
// 4) Uložení údajů o dítěti (+ automatická věková klasifikace)
// ---------------------------------------------------------------------------

export interface SaveDiteInput {
  dite_jmeno: string
  dite_prijmeni: string
  rodne_cislo?: string | null
  datum_narozeni: string
  misto_narozeni?: string | null
  statni_obcanstvi?: string | null
  pohlavi?: string | null
  zdravotni_pojistovna?: string | null
  lekar?: string | null
  melo_odklad: boolean
  zdravotni_omezeni?: string | null
  dalsi_informace?: string | null
  dosavadni_skola?: string | null
  specificke_potreby: EnrollmentSpecifickePotreby
  budouci_rocnik?: number | null
  // Přestup
  prestup_k_datu?: string | null
  soucasna_skola?: string | null
  soucasna_trida?: string | null
  individualni_vzdelavani?: boolean | null
  prestup_doporuceni_stav?: EnrollmentPrestupDoporuceni | null
}

export async function saveEnrollmentDite(
  appId: string,
  input: SaveDiteInput
): Promise<EnrollmentResult> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const guard = await assertOwnerEditable(supabase, user.id, appId)
  if (!guard.ok) return { success: false, error: guard.error }

  if (!input.dite_jmeno?.trim() || !input.dite_prijmeni?.trim()) {
    return { success: false, error: 'Vyplňte jméno a příjmení dítěte.' }
  }
  if (!input.datum_narozeni) {
    return { success: false, error: 'Vyplňte datum narození dítěte.' }
  }

  // Věková klasifikace (uloží se spolu s daty)
  const rokZapisu = await odvodRokZapisu(supabase)
  const { data: klas } = await supabase.rpc('enrollment_classify_age', {
    p_datum_narozeni: input.datum_narozeni,
    p_melo_odklad: input.melo_odklad,
    p_rok_zapisu: rokZapisu,
    p_skolni_rok_zacatek: `${rokZapisu}-09-01`,
  })
  const k = Array.isArray(klas) && klas.length > 0 ? klas[0] : null

  const { error } = await supabase
    .from('enrollment_applications')
    .update({
      dite_jmeno: input.dite_jmeno.trim(),
      dite_prijmeni: input.dite_prijmeni.trim(),
      rodne_cislo: input.rodne_cislo?.trim() || null,
      datum_narozeni: input.datum_narozeni,
      misto_narozeni: input.misto_narozeni?.trim() || null,
      statni_obcanstvi: input.statni_obcanstvi?.trim() || null,
      pohlavi: input.pohlavi || null,
      zdravotni_pojistovna: input.zdravotni_pojistovna?.trim() || null,
      lekar: input.lekar?.trim() || null,
      melo_odklad: input.melo_odklad,
      zdravotni_omezeni: input.zdravotni_omezeni?.trim() || null,
      dalsi_informace: input.dalsi_informace?.trim() || null,
      dosavadni_skola: input.dosavadni_skola?.trim() || null,
      specificke_potreby: input.specificke_potreby,
      budouci_rocnik: input.budouci_rocnik ?? null,
      prestup_k_datu: input.prestup_k_datu || null,
      soucasna_skola: input.soucasna_skola?.trim() || null,
      soucasna_trida: input.soucasna_trida?.trim() || null,
      individualni_vzdelavani: input.individualni_vzdelavani ?? null,
      prestup_doporuceni_stav: input.prestup_doporuceni_stav || null,
      // Věková klasifikace
      ...(k
        ? {
            vekova_kategorie: k.vekova_kategorie,
            vyzaduje_ppp: k.vyzaduje_ppp,
            vyzaduje_lekare: k.vyzaduje_lekare,
            vyzaduje_specialistu: k.vyzaduje_specialistu,
            odklad_rezim: k.odklad_rezim,
          }
        : {}),
      // Rozpracováno → posun stavu (jen ze 'zalozena')
      ...(await maybeAdvanceToRozpracovany(supabase, appId)),
    })
    .eq('id', appId)

  if (error) {
    return { success: false, error: 'Uložení údajů o dítěti selhalo.' }
  }

  revalidatePath(`/zapis/${appId}`)
  return { success: true }
}

// Posun 'zalozena' → 'dotaznik_rozpracovany' při prvním uložení dat.
async function maybeAdvanceToRozpracovany(supabase: any, appId: string) {
  const { data } = await supabase
    .from('enrollment_applications')
    .select('stav')
    .eq('id', appId)
    .maybeSingle()
  if (data?.stav === 'zalozena') {
    return { stav: 'dotaznik_rozpracovany' as const }
  }
  return {}
}

// ---------------------------------------------------------------------------
// 5) Uložení adresy dítěte (trvalé bydliště + volitelně kontaktní)
//    Ukládá jen VALIDOVANOU adresu — ruian_kod + validated_at povinné.
// ---------------------------------------------------------------------------

export interface SaveDiteAdresaInput {
  trvale: {
    obec: string
    ulice?: string | null
    cislo: string
    psc: string
    ruian_kod: string
  }
  bydli_jinde: boolean
  kontaktni?: {
    obec: string
    ulice?: string | null
    cislo: string
    psc: string
    ruian_kod: string
  } | null
}

export async function saveEnrollmentDiteAdresa(
  appId: string,
  input: SaveDiteAdresaInput
): Promise<EnrollmentResult> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const guard = await assertOwnerEditable(supabase, user.id, appId)
  if (!guard.ok) return { success: false, error: guard.error }

  const t = input.trvale
  if (!t?.ruian_kod || !t?.obec || !t?.cislo || !t?.psc) {
    return { success: false, error: 'Trvalé bydliště dítěte musí být ověřené proti registru adres.' }
  }
  if (input.bydli_jinde) {
    const k = input.kontaktni
    if (!k?.ruian_kod || !k?.obec || !k?.cislo || !k?.psc) {
      return { success: false, error: 'Kontaktní adresa musí být ověřená, nebo odškrtněte „dítě bydlí jinde".' }
    }
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('enrollment_applications')
    .update({
      dite_trvale_bydliste_obec: t.obec,
      dite_trvale_bydliste_ulice: t.ulice || null,
      dite_trvale_bydliste_cislo: t.cislo,
      dite_trvale_bydliste_psc: t.psc,
      dite_trvale_bydliste_ruian_kod: t.ruian_kod,
      dite_trvale_bydliste_validated_at: now,
      dite_bydli_jinde: input.bydli_jinde,
      // Kontaktní adresa — buď kompletní validovaná, nebo vynulovaná
      dite_kontaktni_adresa_obec: input.bydli_jinde ? input.kontaktni!.obec : null,
      dite_kontaktni_adresa_ulice: input.bydli_jinde ? (input.kontaktni!.ulice || null) : null,
      dite_kontaktni_adresa_cislo: input.bydli_jinde ? input.kontaktni!.cislo : null,
      dite_kontaktni_adresa_psc: input.bydli_jinde ? input.kontaktni!.psc : null,
      dite_kontaktni_adresa_ruian_kod: input.bydli_jinde ? input.kontaktni!.ruian_kod : null,
      dite_kontaktni_adresa_validated_at: input.bydli_jinde ? now : null,
    })
    .eq('id', appId)

  if (error) {
    return { success: false, error: 'Uložení adresy dítěte selhalo.' }
  }

  revalidatePath(`/zapis/${appId}`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// 6) Uložení údajů vlastníka (jeho vlastní guardian řádek)
//    Adresa vlastníka — jen validovaná (RÚIAN), nebo žádná.
// ---------------------------------------------------------------------------

export interface SaveOwnerInput {
  first_name: string
  last_name: string
  telefon?: string | null
  pribuzensky_vztah?: string | null
  datova_schranka?: string | null
  adresa?: {
    obec: string
    ulice?: string | null
    cislo: string
    psc: string
    ruian_kod: string
  } | null
}

export async function saveEnrollmentOwner(
  appId: string,
  input: SaveOwnerInput
): Promise<EnrollmentResult> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const guard = await assertOwnerEditable(supabase, user.id, appId)
  if (!guard.ok) return { success: false, error: guard.error }

  if (!input.first_name?.trim() || !input.last_name?.trim()) {
    return { success: false, error: 'Vyplňte jméno a příjmení zákonného zástupce.' }
  }

  const now = new Date().toISOString()
  const maAdresu = !!input.adresa?.ruian_kod

  const { error } = await supabase
    .from('enrollment_guardians')
    .update({
      first_name: input.first_name.trim(),
      last_name: input.last_name.trim(),
      telefon: input.telefon?.trim() || null,
      pribuzensky_vztah: input.pribuzensky_vztah?.trim() || null,
      datova_schranka: input.datova_schranka?.trim() || null,
      address_obec: maAdresu ? input.adresa!.obec : null,
      address_ulice: maAdresu ? (input.adresa!.ulice || null) : null,
      address_cislo: maAdresu ? input.adresa!.cislo : null,
      address_psc: maAdresu ? input.adresa!.psc : null,
      address_ruian_kod: maAdresu ? input.adresa!.ruian_kod : null,
      address_validated_at: maAdresu ? now : null,
    })
    .eq('id', guard.ownerGuardianId)

  if (error) {
    return { success: false, error: 'Uložení údajů zástupce selhalo.' }
  }

  revalidatePath(`/zapis/${appId}`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// 7) Pozvání druhého zástupce (RPC 042 + odeslání e-mailu přes Resend)
// ---------------------------------------------------------------------------

export async function inviteEnrollmentSecondGuardian(
  appId: string,
  input: { email: string; first_name?: string; last_name?: string; pribuzensky_vztah?: string }
): Promise<EnrollmentResult<{ guardianId: string; emailStatus: 'sent' | 'skipped' }>> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  if (!input.email?.trim()) {
    return { success: false, error: 'Zadejte e-mail druhého zástupce.' }
  }

  const { data: guardianId, error } = await supabase.rpc(
    'enrollment_invite_second_guardian',
    {
      p_application_id: appId,
      p_email: input.email.trim().toLowerCase(),
      p_first_name: input.first_name?.trim() || undefined,
      p_last_name: input.last_name?.trim() || undefined,
      p_pribuzensky_vztah: input.pribuzensky_vztah?.trim() || undefined,
    }
  )

  if (error) {
    if (error.message?.includes('už u téhle žádosti použitý')) {
      return { success: false, error: 'Tento e-mail je u žádosti už použitý.' }
    }
    if (error.message?.includes('není vlastník')) {
      return { success: false, error: 'Pozvat dalšího zástupce může jen vlastník žádosti.' }
    }
    return { success: false, error: 'Pozvánku se nepodařilo vytvořit.' }
  }

  // Odeslání e-mailu (idempotentní; při selhání řádek zástupce zůstává)
  let emailStatus: 'sent' | 'skipped' = 'skipped'
  try {
    const res = await sendGuardianInvite(guardianId as string)
    emailStatus = res.status
  } catch (e) {
    console.error('[enrollment] pozvánka: e-mail se nepodařilo odeslat:', e)
    // Řádek existuje — vrátíme úspěch s poznámkou, odeslání lze zopakovat.
  }

  revalidatePath(`/zapis/${appId}`)
  return { success: true, data: { guardianId: guardianId as string, emailStatus } }
}

// ---------------------------------------------------------------------------
// 8) Odeslání žádosti — kontrola úplnosti + eSSL spis (přechod do k_rozhodnuti)
// ---------------------------------------------------------------------------

export async function submitEnrollmentApplication(
  appId: string
): Promise<EnrollmentResult> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const guard = await assertOwnerEditable(supabase, user.id, appId)
  if (!guard.ok) return { success: false, error: guard.error }

  // Načíst žádost + vlastníka a ověřit úplnost povinných polí
  const { data: app } = await supabase
    .from('enrollment_applications')
    .select('*')
    .eq('id', appId)
    .maybeSingle()

  if (!app) return { success: false, error: 'Žádost nenalezena.' }

  const chybi: string[] = []
  if (!app.dite_jmeno?.trim() || !app.dite_prijmeni?.trim()) chybi.push('jméno dítěte')
  if (!app.datum_narozeni || app.datum_narozeni === '1970-01-01') chybi.push('datum narození')
  if (!app.dite_trvale_bydliste_ruian_kod) chybi.push('ověřené trvalé bydliště dítěte')
  if (app.vekova_kategorie === 'prilis_mlade' && !app.prilis_mlade_potvrzeno) {
    return { success: false, error: 'Dítě je pro tento školní rok příliš mladé. Kontaktujte prosím školu.' }
  }

  const { data: owner } = await supabase
    .from('enrollment_guardians')
    .select('first_name, last_name')
    .eq('id', guard.ownerGuardianId)
    .maybeSingle()

  if (!owner?.first_name?.trim() || !owner?.last_name?.trim()) {
    chybi.push('jméno zákonného zástupce')
  }

  if (chibiHasItems(chybi)) {
    return { success: false, error: `Před odesláním doplňte: ${chybi.join(', ')}.` }
  }

  // Založit eSSL spis + dokument žádosti; RPC nastaví stav na 'k_rozhodnuti'.
  const { error: esslErr } = await supabase.rpc('enrollment_essl_open_spis', {
    p_application_id: appId,
  })

  if (esslErr) {
    return { success: false, error: 'Odeslání žádosti selhalo při zakládání spisu. Zkuste to znovu.' }
  }

  // Discord notifikace škole (neblokující)
  void notifyDiscord({
    title: `Nová žádost o ${app.typ === 'zapis' ? 'zápis' : 'přestup'}`,
    description: `${app.dite_jmeno} ${app.dite_prijmeni} (nar. ${app.datum_narozeni})`,
    color: 0x0f6e56,
    timestamp: new Date().toISOString(),
  }).catch(() => {})

  revalidatePath(`/zapis/${appId}`)
  revalidatePath(`/zapis/${appId}/stav`)
  return { success: true }
}

function chibiHasItems(arr: string[]): boolean {
  return arr.length > 0
}

// ---------------------------------------------------------------------------
// 9) Potvrzení prilis_mlade vlastníkem (explicitní vědomé potvrzení)
// ---------------------------------------------------------------------------

export async function confirmPrilisMlade(appId: string): Promise<EnrollmentResult> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const guard = await assertOwnerEditable(supabase, user.id, appId)
  if (!guard.ok) return { success: false, error: guard.error }

  const { error } = await supabase
    .from('enrollment_applications')
    .update({ prilis_mlade_potvrzeno: true })
    .eq('id', appId)

  if (error) return { success: false, error: 'Potvrzení se nepodařilo uložit.' }

  revalidatePath(`/zapis/${appId}`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// 10) Napojení a potvrzení druhého zástupce (join stránka /zapis/pripojit/[id])
// ---------------------------------------------------------------------------

// Bootstrap napojení (RPC 044) — voláno rovnou v server komponentě stránky
// /zapis/pripojit/[guardianId], stejný vzor jako get_or_link_guardian_self
// v app/portal/layout.tsx. Idempotentní; ověřuje shodu e-mailu na serveru.
export async function linkSecondGuardianSelf(
  guardianId: string
): Promise<EnrollmentResult<{ applicationId: string }>> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { data, error } = await supabase.rpc(
    'enrollment_link_second_guardian',
    { p_guardian_id: guardianId }
  )

  if (error) {
    if (error.message?.includes('neodpovídá pozvánce')) {
      return {
        success: false,
        error: `Přihlášený e-mail (${user.email}) neodpovídá pozvánce. Přihlaste se prosím e-mailem, na který pozvánka přišla.`,
      }
    }
    if (error.message?.includes('napojena na jiný účet')) {
      return { success: false, error: 'Tato pozvánka už je použitá jiným účtem.' }
    }
    if (error.message?.includes('nenalezena')) {
      return { success: false, error: 'Pozvánka nebyla nalezena — zkontrolujte prosím odkaz z e-mailu.' }
    }
    return { success: false, error: 'Napojení k žádosti selhalo. Zkuste to znovu.' }
  }

  const row = Array.isArray(data) ? data[0] : data
  return { success: true, data: { applicationId: row.application_id as string } }
}

// Potvrzení žádosti druhým zástupcem — obyčejný UPDATE, RLS už v tuhle
// chvíli propouští (auth_user_id byl nastaven výše přes RPC 044).
export async function confirmSecondGuardian(guardianId: string): Promise<EnrollmentResult> {
  const { supabase, user } = await requireUser()
  if (!user) return { success: false, error: 'Nejste přihlášeni.' }

  const { error } = await supabase
    .from('enrollment_guardians')
    .update({ stav: 'potvrzeno', potvrzeno_at: new Date().toISOString() })
    .eq('id', guardianId)
    .eq('auth_user_id', user.id)

  if (error) return { success: false, error: 'Potvrzení se nepodařilo uložit. Zkuste to znovu.' }

  revalidatePath(`/zapis/pripojit/${guardianId}`)
  return { success: true }
}
