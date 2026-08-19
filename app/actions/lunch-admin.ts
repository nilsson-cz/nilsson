'use server'

// app/actions/lunch-admin.ts
// Ředitelská správa modulu Obědy: číslo jídelny / zapnutí / čas denní SMS
// + odeslání testovací SMS. Zápis do lunch_settings hlídá RLS (is_director()),
// odeslání testu ale nemá DB zápis → ověřujeme roli explicitně (jde na kredit školy).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { sendSms, checkSmsAuth } from '@/lib/sms'

export type LunchAdminResult = { ok?: true; detail?: string; error?: string }

async function getDirectorContext() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase: null, userId: null }
  const { data: me } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if ((me as { role?: string } | null)?.role !== 'director') return { supabase: null, userId: null }
  return { supabase, userId: user.id }
}

/** Normalizuje telefon na +420XXXXXXXXX. Prázdné = ''. Neplatné = null. */
function normalizePhone(raw: string): string | null {
  const v = (raw ?? '').replace(/[\s()-]/g, '')
  if (v === '') return ''
  if (/^\+420\d{9}$/.test(v)) return v
  if (/^00420\d{9}$/.test(v)) return '+' + v.slice(2)
  if (/^\d{9}$/.test(v)) return '+420' + v
  return null
}

export async function updateLunchSettings(input: {
  report_phone: string
  sms_enabled: boolean
  send_hour: number
}): Promise<LunchAdminResult> {
  const { supabase, userId } = await getDirectorContext()
  if (!supabase) return { error: 'Tato akce je dostupná pouze pro ředitele.' }

  const phone = normalizePhone(input.report_phone)
  if (phone === null) {
    return { error: 'Telefon musí být ve tvaru +420 777 123 456 nebo 777123456.' }
  }
  if (!Number.isInteger(input.send_hour) || input.send_hour < 0 || input.send_hour > 23) {
    return { error: 'Hodina odeslání musí být 0–23.' }
  }

  const { error } = await supabase
    .from('lunch_settings')
    .update({
      report_phone: phone || null,
      sms_enabled: input.sms_enabled,
      send_hour: input.send_hour,
      updated_by: userId,
    })
    .eq('id', 1)

  if (error) {
    console.error('[updateLunchSettings]', error)
    return { error: 'Nastavení se nepodařilo uložit.' }
  }
  revalidatePath('/dashboard/sprava-skoly/obedy')
  return { ok: true }
}

export async function sendTestSms(targetPhone: string): Promise<LunchAdminResult> {
  const { supabase } = await getDirectorContext()
  if (!supabase) return { error: 'Tato akce je dostupná pouze pro ředitele.' }

  let number = (targetPhone ?? '').trim()
  if (number) {
    const norm = normalizePhone(number)
    if (norm === null || norm === '') return { error: 'Neplatné cílové číslo.' }
    number = norm
  } else {
    const { data } = await supabase
      .from('lunch_settings')
      .select('report_phone')
      .eq('id', 1)
      .maybeSingle()
    number = (data as { report_phone: string | null } | null)?.report_phone ?? ''
  }
  if (!number) return { error: 'Chybí cílové číslo (vyplňte číslo jídelny).' }

  const time = new Date().toLocaleTimeString('cs-CZ', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit',
  })
  const r = await sendSms({
    number,
    message: `Vilekula obedy TEST ${time} - zkusebni zprava z IS, ignorujte.`,
  })
  if (!r.ok) return { error: `Odeslání selhalo: ${r.detail}` }
  return { ok: true, detail: `Odesláno na ${number} (${r.detail}).` }
}

/** Ověří jen přihlášení k bráně (akce inbox) — bez odeslání SMS a bez kreditu. */
export async function testSmsAuth(): Promise<LunchAdminResult> {
  const { supabase } = await getDirectorContext()
  if (!supabase) return { error: 'Tato akce je dostupná pouze pro ředitele.' }

  const r = await checkSmsAuth()
  if (r.ok) return { ok: true, detail: `${r.detail} · ${r.envInfo}` }
  return { error: `${r.detail} · ${r.envInfo}` }
}
