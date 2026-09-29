'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { zkontrolujRodneCislo } from '@/lib/rodne-cislo'

type Vysledek = { success: true; hodnota: string | null } | { error: string }

async function jenReditel(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'Nepřihlášen'
  const { data: staff } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  return staff?.role === 'director' ? null : 'Údaje pro MŠMT může upravit jen ředitel'
}

function revalidate() {
  revalidatePath('/dashboard/msmt/udaje-zaku')
  revalidatePath('/dashboard/msmt')
}

/**
 * Uloží rodné číslo žáka (students.birth_number) ze stránky Údaje žáků pro MŠMT
 * a propíše ho do přihlášky ze zápisu (enrollment_applications.rodne_cislo).
 *
 * Konvence (lib/rodne-cislo.ts):
 *   - ukládá se ve tvaru „RRMMDD/XXXX" (cizinec „RRNNDD/X001")
 *   - platné = 10 číslic dělitelných 11, nebo dočasný cizinecký kód s „X"
 *   - prázdný vstup → NULL
 *
 * Do MŠMT základního souboru jde jako RODC (bez lomítka). KOD_ZAKA pro soubor
 * „a" s RČ nesouvisí — je to náhodné pětimístné číslo (migrace 131).
 *
 * Oprávnění: pouze director (kontrola zde + RLS na students UPDATE).
 */
export async function updateRodneCislo(studentId: string, rawRc: string): Promise<Vysledek> {
  const supabase = await createSupabaseServerClient()
  const zakaz = await jenReditel(supabase)
  if (zakaz) return { error: zakaz }

  const kontrola = zkontrolujRodneCislo(rawRc)
  if (kontrola.stav === 'neplatne') return { error: kontrola.duvod ?? 'Neplatné rodné číslo' }

  const { error } = await supabase
    .from('students')
    .update({ birth_number: kontrola.formatovane })
    .eq('id', studentId)
  if (error) return { error: error.message }

  // Přihláška ze zápisu drží vlastní kopii RČ — z ní se tisknou dokumenty
  // zápisu (rozhodnutí, oznámení, odklad). Opravu propíšeme i tam, ať dokument
  // vytištěný po opravě nese správné RČ. Žák bez přihlášky (převzatý mimo
  // zápis) → nic se nemění. RLS: enrollment_app_director_all.
  const { error: appError } = await supabase
    .from('enrollment_applications')
    .update({ rodne_cislo: kontrola.formatovane })
    .eq('student_id', studentId)
  if (appError) {
    return { error: `RČ uloženo u žáka, ale ne v přihlášce ze zápisu: ${appError.message}` }
  }

  revalidate()
  revalidatePath('/dashboard/zapis', 'layout')
  return { success: true, hodnota: kontrola.formatovane }
}

/**
 * Položky souboru „a“, které vyplňuje škola (students.msmt_*, migrace 132).
 * Metodika MŠMT 2026: SZ, ZZ a NADANI jen u PO 1. stupně bez doporučení ŠPZ
 * (s doporučením jsou zakódované v ID_ZNEV); ZVJ u všech (0 = nedostatečná
 * znalost vyučovacího jazyka).
 */
export type MsmtSvpPole = 'msmt_sz' | 'msmt_zz' | 'msmt_nadani' | 'msmt_zvj'

const KONTROLA_SVP: Record<MsmtSvpPole, { re: RegExp; chyba: string }> = {
  // SZ — 0, nebo od 2026/27 sedmimístný kód ABCDEFG se škálou 0/1/2/4
  msmt_sz:     { re: /^(0|[0124]{7})$/, chyba: 'SZ je 0, nebo 7 číslic z hodnot 0, 1, 2, 4' },
  msmt_zz:     { re: /^[01]$/,          chyba: 'ZZ je 0 nebo 1' },
  msmt_nadani: { re: /^[01]$/,          chyba: 'NADANI je 0 nebo 1' },
  msmt_zvj:    { re: /^[01]$/,          chyba: 'ZVJ je 0 nebo 1' },
}

/** Výchozí hodnoty (= co škola MŠMT dosud posílala); prázdný vstup je vrací. */
const VYCHOZI_SVP: Record<MsmtSvpPole, string> = {
  msmt_sz: '0', msmt_zz: '0', msmt_nadani: '0', msmt_zvj: '1',
}

/** Uloží položku souboru „a“ u žáka. Oprávnění: pouze director. */
export async function updateMsmtSvp(studentId: string, pole: MsmtSvpPole, raw: string): Promise<Vysledek> {
  const supabase = await createSupabaseServerClient()
  const zakaz = await jenReditel(supabase)
  if (zakaz) return { error: zakaz }

  const k = KONTROLA_SVP[pole]
  if (!k) return { error: 'Neznámé pole' }
  const hodnota = raw.replace(/\s/g, '') || VYCHOZI_SVP[pole]
  if (!k.re.test(hodnota)) return { error: k.chyba }

  const { error } = await supabase
    .from('students')
    .update(
      pole === 'msmt_sz' ? { msmt_sz: hodnota }
      : pole === 'msmt_zz' ? { msmt_zz: hodnota }
      : pole === 'msmt_nadani' ? { msmt_nadani: hodnota }
      : { msmt_zvj: hodnota },
    )
    .eq('id', studentId)
  if (error) return { error: error.message }

  revalidate()
  return { success: true, hodnota }
}

/** Kódy matriky MŠMT, které se u žáka zadávají ručně. */
export type MsmtPole = 'msmt_odhl' | 'msmt_izop' | 'kod_zahajeni'

const KONTROLA: Record<MsmtPole, { re: RegExp; chyba: string }> = {
  // ODHL — předchozí vzdělávání (RAPD), 3 znaky (migrace 130)
  msmt_odhl:    { re: /^[0-9A-Z]{3}$/, chyba: 'ODHL má 3 znaky (např. 010, 101)' },
  // IZOP — 9 číslic (000000000 = dosud nechodil do školy, 999999xxx = zahraničí)
  msmt_izop:    { re: /^\d{9}$/,        chyba: 'IZOP má 9 číslic' },
  // KOD_ZAH — zahájení docházky (RAZD), 1 znak (např. 1, 2, E)
  kod_zahajeni: { re: /^[0-9A-Z]$/,     chyba: 'KOD_ZAH má 1 znak (např. 1, 2, E)' },
}

/**
 * Uloží kód matriky MŠMT u žáka (ODHL / IZOP / KOD_ZAH). Prázdný vstup → NULL.
 * Oprávnění: pouze director.
 */
export async function updateMsmtPole(studentId: string, pole: MsmtPole, raw: string): Promise<Vysledek> {
  const supabase = await createSupabaseServerClient()
  const zakaz = await jenReditel(supabase)
  if (zakaz) return { error: zakaz }

  const k = KONTROLA[pole]
  if (!k) return { error: 'Neznámé pole' }
  const hodnota = raw.replace(/\s/g, '').toUpperCase() || null
  if (hodnota && !k.re.test(hodnota)) return { error: k.chyba }

  const { error } = await supabase
    .from('students')
    .update(
      pole === 'msmt_odhl' ? { msmt_odhl: hodnota }
      : pole === 'msmt_izop' ? { msmt_izop: hodnota }
      : { kod_zahajeni: hodnota },
    )
    .eq('id', studentId)
  if (error) return { error: error.message }

  revalidate()
  return { success: true, hodnota }
}
