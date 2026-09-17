'use server'

/**
 * app/actions/urazy.ts
 *
 * Server actions modulu Úrazy (evidence žákovského úrazu, Fáze 1 — hybrid).
 * Zápis i čtení je director-only (RLS `urazy_zaznam_dir`, migrace 109). Identita
 * zraněného i ZZ se do záznamu SNAPSHOTUJE — action bere hodnoty z formuláře,
 * nikdy nedotahuje živá data žáka (záznam je právní dokument fixní k úrazu).
 *
 * Číselníková pole se ukládají jako enum-KLÍČ z lib/urazy.ts (TEXT). `je_zaznam`
 * dopočítává shouldBeZaznam() — o povinnosti formuláře rozhoduje naše logika,
 * formulář ČŠI na to samostatné pole nemá.
 *
 * PRD: Nilsson_documentation/daily_notes/PRD-urazy-2026-09-10.md
 */

import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import { shouldBeZaznam, ciselnikLabel, formatPoradove, CAST_TELA, type UrazZaznam } from '@/lib/urazy'
import { buildZaznamAnswers, CSI_B02_PRIJATO } from '@/lib/urazy-csi'
import { CsiUrazApiClient } from '@/lib/urazy-csi-client'
import type { Json } from '@/types/database'
import { Resend } from 'resend'
import { revalidatePath } from 'next/cache'

export type UrazActionResult =
  | { success: true; id: string }
  | { success: false; error: string }

export type SimpleActionResult =
  | { success: true }
  | { success: false; error: string }

/** Aktuální zaměstnanec (id + jméno) — pro created_by a „zapsal/a". */
async function getCurrentStaff(): Promise<{ id: string; jmeno: string } | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('staff')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .maybeSingle()

  const s = data as { id: string; first_name: string; last_name: string } | null
  if (!s) return null
  return { id: s.id, jmeno: `${s.first_name} ${s.last_name}`.trim() }
}

// ---------------------------------------------------------------------------
// Parsování formuláře → řádek urazy_zaznam (sdílené create/update)
// ---------------------------------------------------------------------------

const str = (fd: FormData, key: string): string | null => {
  const v = fd.get(key)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

const bool = (fd: FormData, key: string): boolean => fd.get(key) === 'true'

const int = (fd: FormData, key: string): number | null => {
  const v = str(fd, key)
  if (v == null) return null
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

/** datetime-local / date string → ISO (timestamptz), nebo null. */
const ts = (fd: FormData, key: string): string | null => {
  const v = str(fd, key)
  if (v == null) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Pole záznamu společná pro insert i update (bez evidence/číslování a workflow). */
function parseUrazFields(fd: FormData) {
  const smrtelny = bool(fd, 'smrtelny')
  const narok_nahrada = bool(fd, 'narok_nahrada')
  const dny_nepritomnosti = int(fd, 'dny_nepritomnosti')
  const na_zadost = bool(fd, 'na_zadost')

  return {
    student_id: str(fd, 'student_id'),
    druh_skoly_izo: str(fd, 'druh_skoly_izo'),

    // Snapshot zraněného
    zraneny_jmeno: str(fd, 'zraneny_jmeno') ?? '',
    zraneny_prijmeni: str(fd, 'zraneny_prijmeni') ?? '',
    zraneny_datum_narozeni: str(fd, 'zraneny_datum_narozeni'),
    zraneny_rocnik: int(fd, 'zraneny_rocnik'),
    trida: str(fd, 'trida'),
    zraneny_ulice: str(fd, 'zraneny_ulice'),
    zraneny_psc: str(fd, 'zraneny_psc'),
    zraneny_obec: str(fd, 'zraneny_obec'),

    // Snapshot ZZ
    zz_jmeno: str(fd, 'zz_jmeno'),
    zz_jina_adresa: str(fd, 'zz_jina_adresa'),
    zz_ulice: str(fd, 'zz_ulice'),
    zz_psc: str(fd, 'zz_psc'),
    zz_obec: str(fd, 'zz_obec'),

    // Úraz a okolnosti
    datum_cas: ts(fd, 'datum_cas'),
    zz_vyrozumen: str(fd, 'zz_vyrozumen'),
    zz_vyrozumen_datum_cas: ts(fd, 'zz_vyrozumen_datum_cas'),
    zz_vyrozumen_zpusob: str(fd, 'zz_vyrozumen_zpusob'),
    smrtelny,
    datum_umrti: str(fd, 'datum_umrti'),
    zdravotnicke_zarizeni: str(fd, 'zdravotnicke_zarizeni'),
    popis_udalosti: str(fd, 'popis_udalosti'),
    cast_tela: str(fd, 'cast_tela'),
    pricina: str(fd, 'pricina'),
    druh_cinnosti: str(fd, 'druh_cinnosti'),
    misto_urazu: str(fd, 'misto_urazu'),
    prevence: str(fd, 'prevence'),
    zavineni: str(fd, 'zavineni'),
    vec_zraneni: str(fd, 'vec_zraneni'),
    jina_osoba: str(fd, 'jina_osoba'),
    jina_osoba_jmeno: str(fd, 'jina_osoba_jmeno'),
    zivly_zvirata: str(fd, 'zivly_zvirata'),

    // Svědci, dohled, sepsání
    svedek1: str(fd, 'svedek1'),
    datum_sepsani: str(fd, 'datum_sepsani'),
    dohled_jmeno: str(fd, 'dohled_jmeno'),
    dohled_funkce: str(fd, 'dohled_funkce'),
    dohled_nadrizeny_jmeno: str(fd, 'dohled_nadrizeny_jmeno'),
    dohled_nadrizeny_funkce: str(fd, 'dohled_nadrizeny_funkce'),

    // Naše logika povinnosti záznamu
    dny_nepritomnosti,
    narok_nahrada,
    je_zaznam: shouldBeZaznam({ dny_nepritomnosti, smrtelny, narok_nahrada, na_zadost }),

    poznamka: str(fd, 'poznamka'),
  }
}

function validateUraz(f: ReturnType<typeof parseUrazFields>): string | null {
  if (!f.zraneny_jmeno || !f.zraneny_prijmeni) return 'Jméno a příjmení zraněného jsou povinné.'
  if (!f.datum_cas) return 'Datum a čas úrazu jsou povinné.'
  if (!f.popis_udalosti) return 'Popis události je povinný.'
  return null
}

// ---------------------------------------------------------------------------
// Prefill z karty žáka (pro výběr žáka ve formuláři)
// ---------------------------------------------------------------------------

export interface UrazPrefill {
  zraneny: {
    jmeno: string
    prijmeni: string
    datum_narozeni: string | null
    ulice: string | null
    psc: string | null
    obec: string | null
  }
  zz: {
    jmeno: string | null
    ulice: string | null
    psc: string | null
    obec: string | null
  }
}

/**
 * Předvyplnění snapshotu z karty žáka. Adresa žáka i ZZ pochází z PRIMÁRNÍHO
 * zákonného zástupce (guardians) — students strukturovanou adresu nedrží; stejná
 * konvence jako katalogový list (PRD R9). Hodnoty jsou pak ve formuláři
 * editovatelné (záznam je snapshot fixní k okamžiku úrazu).
 */
export async function getUrazPrefill(studentId: string): Promise<UrazPrefill | null> {
  const supabase = await createServerClient()

  const { data: student } = await supabase
    .from('students')
    .select('first_name, last_name, birth_date')
    .eq('id', studentId)
    .maybeSingle()

  if (!student) return null
  const st = student as { first_name: string; last_name: string; birth_date: string | null }

  type LinkRow = {
    je_primarni_kontakt: boolean | null
    guardians: {
      first_name: string | null
      last_name: string | null
      address_street: string | null
      address_city: string | null
      address_zip: string | null
    } | null
  }

  const { data: links } = await supabase
    .from('student_guardian_links')
    .select(
      'je_primarni_kontakt, guardians ( first_name, last_name, address_street, address_city, address_zip )',
    )
    .eq('student_id', studentId)
    .eq('je_zakonny_zastupce', true)
    .is('platnost_do', null)
    .order('je_primarni_kontakt', { ascending: false })
    .returns<LinkRow[]>()

  const primar = links?.[0]?.guardians ?? null
  const zzJmeno = primar ? [primar.first_name, primar.last_name].filter(Boolean).join(' ') : ''

  return {
    zraneny: {
      jmeno: st.first_name,
      prijmeni: st.last_name,
      datum_narozeni: st.birth_date,
      ulice: primar?.address_street ?? null,
      psc: primar?.address_zip ?? null,
      obec: primar?.address_city ?? null,
    },
    zz: {
      jmeno: zzJmeno || null,
      ulice: primar?.address_street ?? null,
      psc: primar?.address_zip ?? null,
      obec: primar?.address_city ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createUraz(formData: FormData): Promise<UrazActionResult> {
  const supabase = await createServerClient()
  const staff = await getCurrentStaff()
  if (!staff) return { success: false, error: 'Nepřihlášený uživatel.' }

  const fields = parseUrazFields(formData)
  const validationError = validateUraz(fields)
  if (validationError) return { success: false, error: validationError }

  const skolni_rok = str(formData, 'skolni_rok') ?? CURRENT_SCHOOL_YEAR

  // Pořadové číslo = další v řadě daného školního roku. UNIQUE(skolni_rok,
  // poradove_cislo) chrání proti souběhu → při kolizi (23505) zkusíme znovu.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: maxRow } = await supabase
      .from('urazy_zaznam')
      .select('poradove_cislo')
      .eq('skolni_rok', skolni_rok)
      .order('poradove_cislo', { ascending: false })
      .limit(1)
      .maybeSingle()

    const poradove_cislo = ((maxRow as { poradove_cislo: number } | null)?.poradove_cislo ?? 0) + 1

    const { data, error } = await supabase
      .from('urazy_zaznam')
      .insert({
        ...fields,
        skolni_rok,
        poradove_cislo,
        stav: 'rozepsany',
        created_by: staff.id,
      })
      .select('id')
      .single()

    if (!error && data) {
      revalidatePath('/dashboard/urazy')
      return { success: true, id: (data as { id: string }).id }
    }

    if (error?.code === '23505' && attempt < 2) continue // kolize pořadového čísla → retry
    return { success: false, error: error?.message ?? 'Chyba při vytváření záznamu.' }
  }

  return { success: false, error: 'Nepodařilo se přidělit pořadové číslo, zkuste to znovu.' }
}

// ---------------------------------------------------------------------------
// Update (úprava rozepsaného / neuzavřeného záznamu)
// ---------------------------------------------------------------------------

export async function updateUraz(id: string, formData: FormData): Promise<UrazActionResult> {
  const supabase = await createServerClient()
  const staff = await getCurrentStaff()
  if (!staff) return { success: false, error: 'Nepřihlášený uživatel.' }

  const fields = parseUrazFields(formData)
  const validationError = validateUraz(fields)
  if (validationError) return { success: false, error: validationError }

  const { error } = await supabase.from('urazy_zaznam').update(fields).eq('id', id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/urazy')
  revalidatePath(`/dashboard/urazy/${id}`)
  return { success: true, id }
}

// ---------------------------------------------------------------------------
// Workflow — jednotlivé kroky (inline server-action formy na detailu)
// ---------------------------------------------------------------------------

/** Zápis do knihy úrazů (§2.1 novely — bez podpisu, jen jméno). */
export async function setKnihaZapis(id: string): Promise<SimpleActionResult> {
  const supabase = await createServerClient()
  const staff = await getCurrentStaff()
  if (!staff) return { success: false, error: 'Nepřihlášený uživatel.' }

  const { error } = await supabase
    .from('urazy_zaznam')
    .update({
      kniha_zapis_at: new Date().toISOString().slice(0, 10),
      kniha_zapis_kdo: staff.jmeno,
    })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath(`/dashboard/urazy/${id}`)
  revalidatePath('/dashboard/urazy')
  return { success: true }
}

/** Označit záznam jako připravený k odeslání do ČŠI. */
export async function setKOdeslani(id: string): Promise<SimpleActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('urazy_zaznam')
    .update({ stav: 'k_odeslani' })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath(`/dashboard/urazy/${id}`)
  revalidatePath('/dashboard/urazy')
  return { success: true }
}

/**
 * Fáze 1: ruční potvrzení, že záznam byl odeslán do InspIS DATA. Zapíše čas +
 * kdo a překlopí stav. (Fáze 2 tohle nahradí výsledkem přímého API volání.)
 */
export async function confirmOdeslanoCsi(id: string): Promise<SimpleActionResult> {
  const supabase = await createServerClient()
  const staff = await getCurrentStaff()
  if (!staff) return { success: false, error: 'Nepřihlášený uživatel.' }

  const { error } = await supabase
    .from('urazy_zaznam')
    .update({
      stav: 'odeslano_csi',
      csi_stav: 'prijato',
      odeslano_csi_at: new Date().toISOString(),
      odeslano_csi_by: staff.id,
    })
    .eq('id', id)

  if (error) return { success: false, error: error.message }
  revalidatePath(`/dashboard/urazy/${id}`)
  revalidatePath('/dashboard/urazy')
  return { success: true }
}

export type CsiOdeslaniResult =
  | { success: true; a01id: number }
  | { success: false; error: string }

/**
 * Fáze 2: přímé odeslání záznamu do ČŠI / InspIS DATA přes REST API
 * (CsiUrazApiClient). Sestaví odpovědi z aktuálního záznamu, projede workflow
 * (CreateInline → SaveAnswers → RunWorkflowStep 359) a uloží identifikátory ČŠI.
 * Při chybě (vč. chybějícího oprávnění ke kroku) vrací hlášku z ČŠI a stav se
 * nemění — ruční potvrzení (confirmOdeslanoCsi) zůstává jako záloha.
 */
export async function odeslatCsi(id: string): Promise<CsiOdeslaniResult> {
  const supabase = await createServerClient()
  const staff = await getCurrentStaff()
  if (!staff) return { success: false, error: 'Nepřihlášený uživatel.' }

  const { data: z } = await supabase.from('urazy_zaznam').select('*').eq('id', id).single<UrazZaznam>()
  if (!z) return { success: false, error: 'Záznam nenalezen.' }
  if (z.odeslano_csi_at) return { success: false, error: 'Záznam už byl odeslán do ČŠI.' }

  const answers = buildZaznamAnswers(z)

  let result: { a01ID: number; a11ID: number }
  try {
    const client = new CsiUrazApiClient()
    result = await client.submitZaznam(answers, `Nilsson IS – ${formatPoradove(z.poradove_cislo, z.skolni_rok)}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Neznámá chyba při odeslání do ČŠI.'
    console.error('[urazy odeslatCsi]', msg)
    return { success: false, error: msg }
  }

  const { error } = await supabase
    .from('urazy_zaznam')
    .update({
      stav: 'odeslano_csi',
      csi_stav: 'prijato',
      csi_zaznam_id: String(result.a01ID),
      csi_a01id: result.a01ID,
      csi_a11id: result.a11ID,
      csi_b02id: CSI_B02_PRIJATO,
      csi_payload: answers as unknown as Json,
      odeslano_csi_at: new Date().toISOString(),
      odeslano_csi_by: staff.id,
    })
    .eq('id', id)

  if (error) {
    return {
      success: false,
      error: `Záznam byl odeslán do ČŠI (č. ${result.a01ID}), ale uložení stavu v IS selhalo: ${error.message}`,
    }
  }

  revalidatePath(`/dashboard/urazy/${id}`)
  revalidatePath('/dashboard/urazy')
  return { success: true, a01id: result.a01ID }
}

/** Ruční označení, že ZZ byl informován (např. telefonicky) — bez odeslání e-mailu. */
export async function setZzNotifikovan(id: string): Promise<SimpleActionResult> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .from('urazy_zaznam')
    .update({ zz_notifikovan_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { success: false, error: error.message }
  revalidatePath(`/dashboard/urazy/${id}`)
  return { success: true }
}

export type NotifyResult =
  | { success: true; sent: number }
  | { success: false; error: string }

/**
 * Informuje zákonné zástupce o úrazu e-mailem (R5). Příjemci = všichni AKTIVNÍ
 * zákonní zástupci propojeného žáka s e-mailem — stejné pravidlo jako Platby a
 * Bulletin (viz [[prijemci-notifikaci-zz]]). Po úspěšném odeslání zapíše
 * zz_notifikovan_at. Vyžaduje propojeného žáka (student_id).
 */
export async function notifyZzUraz(id: string): Promise<NotifyResult> {
  const supabase = await createServerClient()
  const staff = await getCurrentStaff()
  if (!staff) return { success: false, error: 'Nepřihlášený uživatel.' }

  const { data: z } = await supabase
    .from('urazy_zaznam')
    .select('*')
    .eq('id', id)
    .single<UrazZaznam>()

  if (!z) return { success: false, error: 'Záznam nenalezen.' }
  if (!z.student_id) {
    return {
      success: false,
      error: 'Záznam není propojen se žákem — zákonné zástupce nelze dohledat. Použijte ruční označení.',
    }
  }

  // Aktivní zákonní zástupci žáka s e-mailem (shodně s payments.sendNotifications).
  const today = new Date().toISOString().slice(0, 10)
  const { data: links, error: gErr } = await supabase
    .from('student_guardian_links')
    .select('guardian:guardian_id ( first_name, last_name, email )')
    .eq('student_id', z.student_id)
    .eq('je_zakonny_zastupce', true)
    .or(`platnost_do.is.null,platnost_do.gte.${today}`)

  if (gErr) {
    console.error('[urazy notifyZz] links:', gErr)
    return { success: false, error: 'Chyba načítání zákonných zástupců.' }
  }

  const recipients = ((links as { guardian: { first_name: string; last_name: string; email: string | null } | null }[]) ?? [])
    .map((l) => l.guardian)
    .filter((g): g is { first_name: string; last_name: string; email: string } => Boolean(g?.email))

  if (recipients.length === 0) {
    return { success: false, error: 'Žádný aktivní zákonný zástupce s e-mailem.' }
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const dite = `${z.zraneny_jmeno} ${z.zraneny_prijmeni}`.trim()
  const datum = z.datum_cas
    ? new Date(z.datum_cas).toLocaleString('cs-CZ', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'
  const castTela = ciselnikLabel(CAST_TELA, z.cast_tela)

  let sent = 0
  for (const g of recipients) {
    const { error: emailErr } = await resend.emails.send({
      from: 'ZŠ Vilekula <nilsson@zsvilekula.cz>',
      to: g.email,
      subject: `Informace o úrazu — ${dite}`,
      html: `
        <p>Vážení,</p>
        <p>informujeme Vás, že u Vašeho dítěte <strong>${dite}</strong> došlo ve škole k úrazu.</p>
        <table>
          <tr><td>Datum a čas:</td><td><strong>${datum}</strong></td></tr>
          ${castTela ? `<tr><td>Zraněná část těla:</td><td>${castTela}</td></tr>` : ''}
          ${z.popis_udalosti ? `<tr><td>Popis:</td><td>${z.popis_udalosti}</td></tr>` : ''}
        </table>
        <p>Úraz byl zapsán do knihy úrazů školy${z.je_zaznam ? ' a je o něm vyhotovován záznam o úrazu dle vyhlášky č. 64/2005 Sb' : ''}.</p>
        <p>V případě dotazů se prosím obraťte na vedení školy.</p>
        <p>ZŠ Vilekula</p>
      `,
    })
    if (emailErr) {
      console.error(`[urazy notifyZz] Resend chyba pro ${g.email}:`, emailErr)
    } else {
      sent++
    }
  }

  if (sent === 0) return { success: false, error: 'Odeslání se nezdařilo, zkuste to znovu.' }

  await supabase
    .from('urazy_zaznam')
    .update({ zz_notifikovan_at: new Date().toISOString() })
    .eq('id', id)

  revalidatePath(`/dashboard/urazy/${id}`)
  revalidatePath('/dashboard/urazy')
  return { success: true, sent }
}

// ---------------------------------------------------------------------------
// Aktualizace záznamu (náhrada za bolest/ZSU nebo úmrtí — pole 30–34)
// ---------------------------------------------------------------------------

export async function addAktualizace(
  urazId: string,
  formData: FormData,
): Promise<SimpleActionResult> {
  const supabase = await createServerClient()
  const staff = await getCurrentStaff()
  if (!staff) return { success: false, error: 'Nepřihlášený uživatel.' }

  const triBool = (key: string): boolean | null => {
    const v = str(formData, key)
    if (v == null) return null
    return v === 'true'
  }

  const { error } = await supabase.from('urazy_aktualizace').insert({
    uraz_id: urazId,
    datum_sepsani: str(formData, 'datum_sepsani'),
    nahrada_bolest: triBool('nahrada_bolest'),
    nahrada_zsu: triBool('nahrada_zsu'),
    smrtelny: triBool('smrtelny'),
    datum_umrti: str(formData, 'datum_umrti'),
    dohled_nadrizeny_jmeno: str(formData, 'dohled_nadrizeny_jmeno'),
    dohled_nadrizeny_funkce: str(formData, 'dohled_nadrizeny_funkce'),
    poznamka: str(formData, 'poznamka'),
    created_by: staff.id,
  })

  if (error) return { success: false, error: error.message }

  // Aktualizace posouvá kořenový záznam do stavu 'aktualizovano'.
  await supabase.from('urazy_zaznam').update({ stav: 'aktualizovano' }).eq('id', urazId)

  revalidatePath(`/dashboard/urazy/${urazId}`)
  revalidatePath('/dashboard/urazy')
  return { success: true }
}

/** Smazání rozepsaného záznamu (jen dokud nebyl odeslán ČŠI). */
export async function deleteUraz(id: string): Promise<SimpleActionResult> {
  const supabase = await createServerClient()

  const { data: row } = await supabase
    .from('urazy_zaznam')
    .select('odeslano_csi_at')
    .eq('id', id)
    .maybeSingle()

  if ((row as { odeslano_csi_at: string | null } | null)?.odeslano_csi_at) {
    return { success: false, error: 'Odeslaný záznam nelze smazat (právní dokument).' }
  }

  const { error } = await supabase.from('urazy_zaznam').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/urazy')
  return { success: true }
}
