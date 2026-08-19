'use server'

/**
 * app/actions/portal-tripartita.ts
 * Server Action pro rezervaci tripartitního termínu z rodičovského portálu.
 * Volá RPC reserve_tripartita_slot (atomická rezervace) + odesílá potvrzovací email.
 */

import { Resend } from 'resend'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const resend = new Resend(process.env.RESEND_API_KEY)

export type ReserveResult =
  | { success: true; studentName: string; slotLabel: string; eventName: string }
  | { success: false; error: string }

export async function reserveSlot(
  slotId: string,
  studentId: string,
  note: string,
): Promise<ReserveResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejsi přihlášen.' }

  // Zavolej atomickou RPC funkci
  const { data: rpcResult, error: rpcError } = await supabase
    .rpc('reserve_tripartita_slot' as any, {
      p_slot_id: slotId,
      p_student_id: studentId,
      p_note: note.trim() || null,
    })

  if (rpcError) return { success: false, error: rpcError.message }

  const result = rpcResult as string
  if (result === 'slot_full')        return { success: false, error: 'Termín je již obsazen.' }
  if (result === 'already_reserved') return { success: false, error: 'Toto dítě již má rezervaci na tuto událost.' }
  if (result === 'not_your_child')   return { success: false, error: 'Nemáš oprávnění rezervovat za toto dítě.' }
  if (result === 'event_not_active') return { success: false, error: 'Událost již není aktivní.' }
  if (result !== 'ok')               return { success: false, error: 'Neočekávaná chyba rezervace.' }

  // Načti data pro email
  const { data: slotRaw } = await supabase
    .from('tripartita_slots')
    .select('label, event_id, tripartita_events!inner(name)')
    .eq('id', slotId)
    .single()

  const { data: studentRaw } = await supabase
    .from('students')
    .select('first_name, last_name')
    .eq('id', studentId)
    .single()

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('first_name, last_name, email')
    .eq('user_id', user.id)
    .single()

  const slot = slotRaw as any
  const student = studentRaw as any
  const guardian = guardianRaw as any

  const studentName = student ? `${student.first_name} ${student.last_name}` : 'Vaše dítě'
  const slotLabel = slot?.label ?? ''
  const eventName = slot?.tripartita_events?.name ?? 'Tripartita'

  // Odešli potvrzovací email — neblokující, chyba nesmí zrušit rezervaci
  if (guardian?.email) {
    try {
      await resend.emails.send({
        from: 'ZŠ Vilekula <noreply@zsvilekula.cz>',
        to: guardian.email,
        subject: `Potvrzení rezervace — ${eventName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1c1917;">
            <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">
              Rezervace potvrzena
            </h2>
            <p style="color: #78716c; margin-bottom: 24px;">
              Dobrý den, ${guardian.first_name} ${guardian.last_name},
            </p>
            <p>Vaše rezervace tripartitní schůzky byla úspěšně zaznamenána.</p>

            <div style="background: #f5f5f4; border-radius: 12px; padding: 20px; margin: 24px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="color: #78716c; font-size: 13px; padding: 4px 0; width: 120px;">Událost</td>
                  <td style="font-weight: 500; font-size: 14px; padding: 4px 0;">${eventName}</td>
                </tr>
                <tr>
                  <td style="color: #78716c; font-size: 13px; padding: 4px 0;">Termín</td>
                  <td style="font-weight: 500; font-size: 14px; padding: 4px 0;">${slotLabel}</td>
                </tr>
                <tr>
                  <td style="color: #78716c; font-size: 13px; padding: 4px 0;">Dítě</td>
                  <td style="font-weight: 500; font-size: 14px; padding: 4px 0;">${studentName}</td>
                </tr>
                ${note.trim() ? `
                <tr>
                  <td style="color: #78716c; font-size: 13px; padding: 4px 0; vertical-align: top;">Poznámka</td>
                  <td style="font-size: 14px; padding: 4px 0;">${note.trim()}</td>
                </tr>` : ''}
              </table>
            </div>

            <p style="font-size: 13px; color: #a8a29e;">
              V případě dotazů nás kontaktujte na
              <a href="mailto:nilsson@zsvilekula.cz" style="color: #f97316;">nilsson@zsvilekula.cz</a>.
            </p>
            <p style="font-size: 13px; color: #a8a29e; margin-top: 24px;">
              ZŠ Vilekula Teplice
            </p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error('[portal-tripartita] Email selhal:', emailErr)
      // Záměrně nepropagujeme chybu — rezervace proběhla úspěšně
    }
  }

  return { success: true, studentName, slotLabel, eventName }
}
