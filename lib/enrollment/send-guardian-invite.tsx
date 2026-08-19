// lib/enrollment/send-guardian-invite.ts
// Odeslání pozvánky druhému zákonnému zástupci — volá se hned po úspěšném
// enrollment_invite_second_guardian RPC (viz migrace 042). Styl a struktura
// sjednoceny s lib/bulletin/recipients.ts (createSupabaseServerClient,
// RPC pro DB-side logiku, throw Error s kontextem při chybě).
//
// POZOR — TODO než nasadíš:
// 1) EmailSourceType v types/bulletin.ts (nebo kde skutečně žije) má teď
//    jen 'bulletin' | 'payment'. Potřebuje rozšířit o 'enrollment', jinak
//    ti TypeScript spadne na typové kontrole při zápisu do email_events.
// 2) APP_BASE_URL (dřív PORTAL_BASE_URL, přejmenováno kvůli přesnosti —
//    "portal" v názvu svádělo k omylu zahrnout i /portal segment cesty,
//    viz komentář u definice níže) je teď ověřená hodnota
//    (https://nilsson.zsvilekula.cz), RESEND_FROM_ENROLLMENT je
//    pořád jen odhad — nahraď skutečnou hodnotou/env proměnnou.
// 3) Předpokládám `resend` npm balíček (Resend.emails.send({ react: ... })),
//    stejně jako BulletinEmail.tsx — pokud má bulletin vlastní sdílený
//    Resend klient (např. lib/resend.ts s exportovanou instancí), použij
//    radši ten, ať se klient nevytváří na dvou místech zvlášť.

import { Resend } from 'resend';
import * as React from 'react';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { GuardianInviteEmail } from '@/emails/GuardianInviteEmail';
import type { EmailSourceType } from '@/types/bulletin'; // TODO: bod (1) výše

const resend = new Resend(process.env.RESEND_API_KEY);

const RESEND_FROM_ENROLLMENT = process.env.RESEND_FROM_ENROLLMENT ?? 'zapis@zsvilekula.cz'; // TODO ověřit
// POZOR: jen doména/root, BEZ /portal segmentu — /zapis/* žije mimo /portal/*
// (portál vyžaduje existujícího guardiana, zápis je veřejný vstupní bod).
// Ověřeno: portálová sekce je https://nilsson.zsvilekula.cz/portal,
// tedy doména je https://nilsson.zsvilekula.cz.
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'https://nilsson.zsvilekula.cz';

export interface SendGuardianInviteResult {
  status: 'sent' | 'skipped';
  reason?: string;
}

/**
 * Pošle pozvánku druhému zákonnému zástupci k žádosti o zápis/přestup.
 * Idempotentní — pokud zástupce mezitím registraci dokončil (stav už
 * není 'pozvan'), pošta se nepošle znovu a vrátí se status 'skipped'.
 *
 * @param guardianId - enrollment_guardians.id (vráceno z
 *                     enrollment_invite_second_guardian RPC)
 */
export async function sendGuardianInvite(
  guardianId: string,
): Promise<SendGuardianInviteResult> {
  const supabase = await createSupabaseServerClient();

  const { data: guardian, error: guardianErr } = await supabase
    .from('enrollment_guardians')
    .select(`
      id, email, first_name, last_name, stav,
      enrollment_applications:application_id (
        dite_jmeno, dite_prijmeni
      )
    `)
    .eq('id', guardianId)
    .single();

  if (guardianErr || !guardian) {
    throw new Error(`Zástupce ${guardianId} nenalezen: ${guardianErr?.message}`);
  }

  if (guardian.stav !== 'pozvan') {
    return { status: 'skipped', reason: `stav zástupce už není 'pozvan' (je '${guardian.stav}')` };
  }

  const childName = guardian.enrollment_applications
    ? `${guardian.enrollment_applications.dite_jmeno} ${guardian.enrollment_applications.dite_prijmeni}`
    : 'dítě';

  const inviteUrl = `${APP_BASE_URL}/zapis/pripojit/${guardian.id}`;

  const { data: sendResult, error: sendErr } = await resend.emails.send({
    from: RESEND_FROM_ENROLLMENT,
    to: guardian.email,
    subject: `Pozvánka k žádosti o zápis — ${childName}`,
    react: (
      <GuardianInviteEmail
        childName={childName}
        inviteeName={guardian.first_name}
        inviteUrl={inviteUrl}
      />
    ),
  });

  if (sendErr) {
    throw new Error(`Odeslání přes Resend selhalo: ${sendErr.message}`);
  }

  // email_events — stejný tracking mechanismus jako bulletin (viz
  // types/bulletin.ts EmailEventRow). source_type 'enrollment' potřebuje
  // rozšíření typu, viz TODO (1) v hlavičce souboru.
  const { error: eventErr } = await supabase.from('email_events').insert({
    source_type: 'enrollment' as EmailSourceType,
    source_id: guardian.id,
    guardian_id: guardian.id,
    email_address: guardian.email,
    event_type: 'sent',
    resend_id: sendResult?.id ?? null,
    metadata: null,
  });

  if (eventErr) {
    // E-mail už reálně odešel — nechceme to tvářit jako celkové selhání,
    // ale je důležité to zalogovat.
    console.error('[enrollment/send-guardian-invite] e-mail odeslán, ale zápis do email_events selhal:', eventErr);
  }

  const { error: markErr } = await supabase.rpc('enrollment_mark_invite_sent', {
    p_guardian_id: guardianId,
  });

  if (markErr) {
    console.error('[enrollment/send-guardian-invite] e-mail odeslán, ale enrollment_mark_invite_sent selhal:', markErr);
  }

  return { status: 'sent' };
}
