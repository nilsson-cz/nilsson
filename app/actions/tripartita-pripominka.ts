'use server'

/**
 * app/actions/tripartita-pripominka.ts
 * Připomenutí rezervace tripartity e-mailem rodičům dětí, které ještě nemají
 * termín. Jen ředitel. Každé odeslání se zapisuje do email_events
 * (source_type 'tripartita_reminder', source_id = událost).
 */

import { Resend } from 'resend'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getReminderRecipients } from '@/lib/tripartita-prehled'

const resend = new Resend(process.env.RESEND_API_KEY)

export type ReminderResult =
  | { success: true; sent: number; failed: number }
  | { success: false; error: string }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function reminderHtml(eventName: string, text: string, children: string[], link: string): string {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin: 0 0 16px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  const childList = children.map((c) => escapeHtml(c)).join(', ')

  return `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1c1917;">
      <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 16px;">
        Připomenutí: ${escapeHtml(eventName)}
      </h2>
      ${paragraphs}
      <p style="margin: 0 0 24px; color: #78716c; font-size: 14px;">
        Termín zatím není rezervovaný pro: <strong style="color: #1c1917;">${childList}</strong>
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${link}"
           style="display: inline-block; background: #f97316; color: #ffffff; text-decoration: none;
                  font-weight: 600; font-size: 14px; padding: 12px 20px; border-radius: 12px;">
          Rezervovat termín
        </a>
      </p>
      <p style="font-size: 13px; color: #a8a29e;">
        Pokud tlačítko nefunguje, otevřete odkaz: <a href="${link}" style="color: #f97316;">${link}</a>
      </p>
      <p style="font-size: 13px; color: #a8a29e; margin-top: 24px;">
        ZŠ Vilekula Teplice
      </p>
    </div>
  `
}

export async function sendTripartitaReminder(
  eventId: string,
  groupId: string | null,
  text: string,
): Promise<ReminderResult> {
  if (!text.trim()) return { success: false, error: 'Doprovodný text je povinný.' }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejsi přihlášen.' }

  const { data: staff } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (staff?.role !== 'director') return { success: false, error: 'Nemáš oprávnění.' }

  const { data: event } = await supabase
    .from('tripartita_events')
    .select('id, name, school_year, active')
    .eq('id', eventId)
    .maybeSingle()
  if (!event) return { success: false, error: 'Událost nenalezena.' }
  if (!event.active) return { success: false, error: 'Událost není aktivní — rodiče by termíny neviděli.' }

  const recipients = await getReminderRecipients(supabase, eventId, event.school_year, groupId)
  if (recipients.length === 0) {
    return { success: false, error: 'Nejsou žádní rodiče s e-mailem, kterým by šlo připomenutí poslat.' }
  }

  const link = `${process.env.NEXT_PUBLIC_APP_URL}/portal/tripartita`
  let sent = 0
  let failed = 0
  for (const r of recipients) {
    try {
      const { data, error } = await resend.emails.send({
        from: 'ZŠ Vilekula <nilsson@zsvilekula.cz>',
        to: r.email,
        subject: `Připomenutí: ${event.name}`,
        html: reminderHtml(event.name, text, r.children, link),
      })
      if (error) {
        console.error('[tripartita-pripominka] Resend chyba:', error, { guardian_id: r.guardianId })
        failed++
        continue
      }
      await supabase.from('email_events').insert({
        source_type: 'tripartita_reminder',
        source_id: event.id,
        guardian_id: r.guardianId,
        email_address: r.email,
        event_type: 'sent',
        resend_id: data?.id ?? null,
      })
      sent++
    } catch (err) {
      console.error('[tripartita-pripominka] Výjimka:', err)
      failed++
    }
  }

  return { success: true, sent, failed }
}
