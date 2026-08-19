import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { linkSecondGuardianSelf } from '@/app/actions/enrollment'
import ConfirmSecondGuardian from './ConfirmSecondGuardian'
import { STAV_LABELS, STAV_VARIANT, GUARDIAN_ROLE_LABELS, type EnrollmentStav, type GuardianRole } from '@/lib/enrollment/types'

// app/zapis/pripojit/[guardianId]/page.tsx
// Cíl pozvánky pro druhého zákonného zástupce (e-mail z sendGuardianInvite,
// lib/enrollment/send-guardian-invite.tsx: `${PORTAL_BASE_URL}/zapis/pripojit/${guardian.id}`).
//
// Flow:
// 1) Nepřihlášený → přesměrování na OTP přihlášení/registraci, `next` zpět sem.
// 2) Přihlášený → rovnou zavoláme bootstrap RPC (enrollment_link_second_guardian,
//    migrace 044) — stejný vzor jako get_or_link_guardian_self v app/portal/layout.tsx.
//    RPC ověří shodu e-mailu s pozvánkou a nastaví auth_user_id (idempotentní).
// 3) Po úspěšném napojení už normální RLS dovolí načíst žádost a zástupcův
//    řádek — zobrazí se read-only náhled dotazníku + tlačítko potvrzení.

export const dynamic = 'force-dynamic'

export default async function PripojitPage({
  params,
}: {
  params: Promise<{ guardianId: string }>
}) {
  const { guardianId } = await params
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/zapis/prihlaseni?next=${encodeURIComponent(`/zapis/pripojit/${guardianId}`)}`)
  }

  const linkResult = await linkSecondGuardianSelf(guardianId)

  if (!linkResult.success) {
    return (
      <div className="max-w-md mx-auto py-8">
        <div className="portal-card p-6 space-y-3">
          <h1 className="text-lg font-semibold text-(--portal-text)">Pozvánku se nepodařilo otevřít</h1>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {linkResult.error}
          </div>
          <p className="text-sm text-(--portal-text-muted)">
            Přihlášeni jste jako <strong>{user.email}</strong>. Pokud pozvánka přišla na jiný
            e-mail, odhlaste se a přihlaste znovu s tím správným.
          </p>
        </div>
      </div>
    )
  }

  // RLS teď (po úspěšném napojení) dovolí číst vlastní řádek i žádost.
  const { data: guardian } = await supabase
    .from('enrollment_guardians')
    .select('id, application_id, first_name, last_name, email, stav, pribuzensky_vztah')
    .eq('id', guardianId)
    .maybeSingle()

  if (!guardian) notFound()

  const { data: app } = await supabase
    .from('enrollment_applications')
    .select('id, typ, stav, dite_jmeno, dite_prijmeni, datum_narozeni, dite_trvale_bydliste_obec, dite_trvale_bydliste_ulice, dite_trvale_bydliste_cislo, dite_trvale_bydliste_psc')
    .eq('id', guardian.application_id)
    .maybeSingle()

  if (!app) notFound()

  // Vlastník žádosti (pro přehled "kdo žádost podal")
  const { data: owner } = await supabase
    .from('enrollment_guardians')
    .select('first_name, last_name, email')
    .eq('application_id', guardian.application_id)
    .eq('role_v_zadosti', 'vlastnik')
    .maybeSingle()

  const diteAdresa = [
    app.dite_trvale_bydliste_ulice, app.dite_trvale_bydliste_cislo,
  ].filter(Boolean).join(' ') + (app.dite_trvale_bydliste_obec ? `, ${app.dite_trvale_bydliste_psc} ${app.dite_trvale_bydliste_obec}` : '')

  return (
    <div className="max-w-md mx-auto py-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-(--portal-text)">
          Pozvánka k žádosti o {app.typ === 'zapis' ? 'zápis' : 'přestup'}
        </h1>
        <p className="mt-1 text-sm text-(--portal-text-muted)">
          Byli jste přizváni jako druhý zákonný zástupce k této žádosti.
        </p>
      </div>

      <div className="portal-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide">Žádost</p>
          <span className={`portal-pill portal-pill-${STAV_VARIANT[app.stav as EnrollmentStav]}`}>
            {STAV_LABELS[app.stav as EnrollmentStav]}
          </span>
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-(--portal-text-subtle)">Dítě</span>
            <span className="text-(--portal-text) font-medium text-right">
              {app.dite_jmeno} {app.dite_prijmeni}
            </span>
          </div>
          {app.datum_narozeni && app.datum_narozeni !== '1970-01-01' && (
            <div className="flex justify-between gap-4">
              <span className="text-(--portal-text-subtle)">Datum narození</span>
              <span className="text-(--portal-text) text-right">{app.datum_narozeni}</span>
            </div>
          )}
          {app.dite_trvale_bydliste_obec && (
            <div className="flex justify-between gap-4">
              <span className="text-(--portal-text-subtle)">Trvalé bydliště</span>
              <span className="text-(--portal-text) text-right">{diteAdresa}</span>
            </div>
          )}
          {owner && (
            <div className="flex justify-between gap-4">
              <span className="text-(--portal-text-subtle)">Žádost podal(a)</span>
              <span className="text-(--portal-text) text-right">
                {[owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email}
              </span>
            </div>
          )}
          {guardian.pribuzensky_vztah && (
            <div className="flex justify-between gap-4">
              <span className="text-(--portal-text-subtle)">Váš vztah k dítěti</span>
              <span className="text-(--portal-text) text-right">
                {GUARDIAN_ROLE_LABELS[guardian.pribuzensky_vztah as GuardianRole] ?? guardian.pribuzensky_vztah}
              </span>
            </div>
          )}
        </div>
      </div>

      <ConfirmSecondGuardian guardianId={guardian.id} stav={guardian.stav as any} appId={guardian.application_id} />
    </div>
  )
}
