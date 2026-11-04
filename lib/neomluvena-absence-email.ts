// lib/neomluvena-absence-email.ts — e-mail rodičům, když pedagog zapíše
// neomluvenou absenci (app/actions/dochazka.ts). Jen server.
//
// Volá se jen pro NOVĚ neomluvené dny (přechod z jiného stavu / nový záznam),
// takže opakované uložení stejné docházky nic znovu neposílá.
// Příjemci = všichni aktivní zákonní zástupci s e-mailem (stejné pravidlo jako
// Platby, Bulletin a Úrazy). Lhůta na omluvení = první den absence + 3 dny.
// Chyba odeslání nikdy neshodí uložení docházky — jen se zaloguje.

import { Resend } from 'resend'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { addDays } from '@/lib/omluvenky-zruseni'

const LHUTA_DNU = 3

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDen(iso: string, weekday = true): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    ...(weekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(new Date(iso + 'T12:00:00'))
}

export function neomluvenaHtml(dite: string, dny: string[], lhuta: string, link: string): string {
  const seznam = dny.map((d) => `<li>${escapeHtml(formatDen(d))}</li>`).join('')
  const jedenDen = dny.length === 1
  return `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1c1917;">
      <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 16px;">
        Neomluvená absence — ${escapeHtml(dite)}
      </h2>
      <p style="margin: 0 0 12px;">Vážení,</p>
      <p style="margin: 0 0 12px;">
        v docházce je u Vašeho dítěte <strong>${escapeHtml(dite)}</strong>
        ${jedenDen ? 'zapsaný neomluvený den' : 'zapsáno více neomluvených dnů'}:
      </p>
      <ul style="margin: 0 0 16px; padding-left: 20px;">${seznam}</ul>
      <p style="margin: 0 0 16px;">
        Podle školního řádu je potřeba absenci omluvit do 3 dnů od jejího začátku,
        tedy nejpozději <strong>${escapeHtml(formatDen(lhuta, false))}</strong>.
        Omluvenku můžete zadat v rodičovském portálu.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${link}"
           style="display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none;
                  font-weight: 600; font-size: 14px; padding: 12px 20px; border-radius: 12px;">
          Zadat omluvenku
        </a>
      </p>
      <p style="font-size: 13px; color: #78716c;">
        Pokud už jste absenci omluvili jinak nebo jde o omyl, ozvěte se prosím průvodci.
      </p>
      <p style="font-size: 13px; color: #a8a29e; margin-top: 24px;">
        ZŠ Vilekula Teplice
      </p>
    </div>
  `
}

/**
 * @param nove studentId → seznam nově neomluvených dnů ('YYYY-MM-DD')
 */
export async function notifyNeomluvenaAbsence(nove: Map<string, string[]>): Promise<void> {
  if (nove.size === 0) return
  try {
    const supabase = await createSupabaseServerClient()
    const studentIds = [...nove.keys()]
    const today = new Date().toISOString().slice(0, 10)

    const [{ data: students }, { data: links, error: lErr }] = await Promise.all([
      supabase.from('students').select('id, first_name, last_name').in('id', studentIds),
      supabase
        .from('student_guardian_links')
        .select('student_id, guardian:guardian_id ( email )')
        .in('student_id', studentIds)
        .eq('je_zakonny_zastupce', true)
        .or(`platnost_do.is.null,platnost_do.gte.${today}`),
    ])
    if (lErr) {
      console.error('[neomluvena-absence] links:', lErr)
      return
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const link = `${process.env.NEXT_PUBLIC_APP_URL}/portal/omluvenky/novy`

    for (const s of students ?? []) {
      const dny = [...new Set(nove.get(s.id) ?? [])].sort()
      if (dny.length === 0) continue

      const emaily = [
        ...new Set(
          (links ?? [])
            .filter((l) => l.student_id === s.id)
            .map((l) => (l.guardian as { email: string | null } | null)?.email?.trim())
            .filter((e): e is string => Boolean(e)),
        ),
      ]
      if (emaily.length === 0) {
        console.warn('[neomluvena-absence] žák bez ZZ s e-mailem:', s.id)
        continue
      }

      const dite = `${s.first_name} ${s.last_name}`.trim()
      const html = neomluvenaHtml(dite, dny, addDays(dny[0], LHUTA_DNU), link)

      for (const to of emaily) {
        const { error } = await resend.emails.send({
          from: 'ZŠ Vilekula <nilsson@zsvilekula.cz>',
          to,
          subject: `Neomluvená absence — ${dite}`,
          html,
        })
        if (error) console.error(`[neomluvena-absence] Resend chyba pro ${to}:`, error)
      }
    }
  } catch (err) {
    console.error('[neomluvena-absence] výjimka:', err)
  }
}
