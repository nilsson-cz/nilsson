'use server'

/**
 * app/actions/portal-tripartita.ts
 * Server Actions pro tripartity v rodičovském portálu:
 *   reserveSlot        — RPC reserve_tripartita_slot (atomická rezervace) + potvrzovací email
 *   cancelReservation  — RPC cancel_tripartita_reservation (nejpozději 7 dní před termínem)
 *                        + potvrzovací email o zrušení
 */

import { revalidatePath } from 'next/cache'
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
  if (result === 'wrong_class')      return { success: false, error: 'Tento termín je vypsán pro jinou třídu.' }
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

export type CancelResult =
  | { success: true }
  | { success: false; error: string }

export async function cancelReservation(reservationId: string): Promise<CancelResult> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Nejsi přihlášen.' }

  // Údaje pro potvrzovací email načteme před zrušením (pak už rezervace nebude)
  const { data: reservation } = await supabase
    .from('tripartita_reservations')
    .select('slot_id, event_id, student_id')
    .eq('id', reservationId)
    .maybeSingle()

  const { data: rpcResult, error: rpcError } = await supabase
    .rpc('cancel_tripartita_reservation', { p_reservation_id: reservationId })

  if (rpcError) return { success: false, error: rpcError.message }
  if (rpcResult === 'too_late')         return { success: false, error: 'Rezervaci lze zrušit nejpozději 7 dní před termínem.' }
  if (rpcResult === 'not_found')        return { success: false, error: 'Rezervace už neexistuje.' }
  if (rpcResult === 'not_your_child')   return { success: false, error: 'Nemáš oprávnění zrušit tuto rezervaci.' }
  if (rpcResult === 'event_not_active') return { success: false, error: 'Událost již není aktivní.' }
  if (rpcResult !== 'ok')               return { success: false, error: 'Neočekávaná chyba při rušení rezervace.' }

  // Potvrzovací email — neblokující, chyba nesmí zrušení vrátit zpět
  if (reservation) {
    const [{ data: slot }, { data: event }, { data: student }, { data: guardian }] = await Promise.all([
      supabase.from('tripartita_slots').select('label').eq('id', reservation.slot_id).maybeSingle(),
      supabase.from('tripartita_events').select('name').eq('id', reservation.event_id).maybeSingle(),
      supabase.from('students').select('first_name, last_name').eq('id', reservation.student_id).maybeSingle(),
      supabase.from('guardians').select('first_name, last_name, email').eq('user_id', user.id).maybeSingle(),
    ])

    if (guardian?.email) {
      const eventName = event?.name ?? 'Tripartita'
      const studentName = student ? `${student.first_name} ${student.last_name}` : 'Vaše dítě'
      try {
        await resend.emails.send({
          from: 'ZŠ Vilekula <noreply@zsvilekula.cz>',
          to: guardian.email,
          subject: `Zrušení rezervace — ${eventName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1c1917;">
              <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">
                Rezervace zrušena
              </h2>
              <p style="color: #78716c; margin-bottom: 24px;">
                Dobrý den, ${guardian.first_name} ${guardian.last_name},
              </p>
              <p>Vaše rezervace tripartitní schůzky byla zrušena. Nový termín si můžete vybrat v rodičovském portálu.</p>

              <div style="background: #f5f5f4; border-radius: 12px; padding: 20px; margin: 24px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="color: #78716c; font-size: 13px; padding: 4px 0; width: 120px;">Událost</td>
                    <td style="font-weight: 500; font-size: 14px; padding: 4px 0;">${eventName}</td>
                  </tr>
                  <tr>
                    <td style="color: #78716c; font-size: 13px; padding: 4px 0;">Zrušený termín</td>
                    <td style="font-weight: 500; font-size: 14px; padding: 4px 0;">${slot?.label ?? ''}</td>
                  </tr>
                  <tr>
                    <td style="color: #78716c; font-size: 13px; padding: 4px 0;">Dítě</td>
                    <td style="font-weight: 500; font-size: 14px; padding: 4px 0;">${studentName}</td>
                  </tr>
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
        console.error('[portal-tripartita] Email o zrušení selhal:', emailErr)
      }
    }
  }

  revalidatePath('/portal/tripartita')
  return { success: true }
}
