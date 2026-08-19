import Link from 'next/link'
import { format } from 'date-fns'
import { cs } from 'date-fns/locale'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  STAV_LABELS, STAV_VARIANT,
  type EnrollmentStav, type EnrollmentTyp,
} from '@/lib/enrollment/types'

// app/zapis/page.tsx — Landing stránka zápisu.
// - Zkontroluje otevírací okno (enrollment_settings).
// - Přihlášenému rodiči ukáže jeho existující žádosti + CTA na novou.
// - Nepřihlášenému nabídne přihlášení/registraci.

export const dynamic = 'force-dynamic'

type AppRow = {
  id: string
  typ: EnrollmentTyp
  stav: EnrollmentStav
  dite_jmeno: string
  dite_prijmeni: string
  created_at: string
}

function StavPill({ stav }: { stav: EnrollmentStav }) {
  const variant = STAV_VARIANT[stav]
  return <span className={`portal-pill portal-pill-${variant}`}>{STAV_LABELS[stav]}</span>
}

export default async function ZapisLandingPage() {
  const supabase = await createSupabaseServerClient()

  const { data: settings } = await supabase
    .from('enrollment_settings')
    .select('zapis_otevren, okno_od, okno_do')
    .eq('id', 1)
    .maybeSingle()

  const zapisOtevren = !!settings?.zapis_otevren

  const { data: { user } } = await supabase.auth.getUser()

  // Existující žádosti přihlášeného rodiče (RLS: vidí jen svoje)
  let myApps: AppRow[] = []
  if (user) {
    const { data } = await supabase
      .from('enrollment_applications')
      .select('id, typ, stav, dite_jmeno, dite_prijmeni, created_at')
      .order('created_at', { ascending: false })
    myApps = (data as AppRow[]) ?? []
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-(--portal-text)">
          Zápis a přestup
        </h1>
        <p className="mt-1 text-sm text-(--portal-text-muted)">
          Podání žádosti o zápis do 1. ročníku nebo o přestup z jiné školy.
        </p>
      </div>

      {/* Stav okna zápisu */}
      <div className="portal-card p-4">
        {zapisOtevren ? (
          <div className="flex items-start gap-3">
            <span className="portal-pill portal-pill-success mt-0.5">Zápis otevřen</span>
            <div className="text-sm text-(--portal-text-muted)">
              {settings?.okno_od && settings?.okno_do ? (
                <>Termín zápisu: {format(new Date(settings.okno_od), 'd. M. yyyy', { locale: cs })}
                  {' – '}
                  {format(new Date(settings.okno_do), 'd. M. yyyy', { locale: cs })}.</>
              ) : (
                <>Žádost o zápis lze podat online.</>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <span className="portal-pill portal-pill-warn mt-0.5">Zápis uzavřen</span>
            <div className="text-sm text-(--portal-text-muted)">
              Zápis do 1. ročníku aktuálně není otevřený.
              {settings?.okno_od && (
                <> Předpokládaný termín: {format(new Date(settings.okno_od), 'd. M. yyyy', { locale: cs })}.</>
              )}
              {' '}Přestup z jiné školy lze řešit i mimo termín zápisu — kontaktujte školu.
            </div>
          </div>
        )}
      </div>

      {/* Nepřihlášený rodič */}
      {!user && (
        <div className="portal-card p-5 space-y-4">
          <p className="text-sm text-(--portal-text-muted)">
            Pro podání žádosti se přihlaste e-mailem. Pokud u nás účet ještě nemáte,
            vytvoří se automaticky — stačí zadat e-mail a ověřovací kód.
          </p>
          <Link
            href="/zapis/prihlaseni"
            className="inline-flex items-center px-5 py-2.5 rounded-lg bg-(--portal-accent)
              text-white text-sm font-medium hover:opacity-90 transition"
          >
            Přihlásit se a podat žádost
          </Link>
        </div>
      )}

      {/* Přihlášený rodič — existující žádosti */}
      {user && (
        <div className="space-y-4">
          {myApps.length > 0 && (
            <div>
              <h2 className="portal-section-title">Vaše žádosti</h2>
              <div className="portal-card divide-y divide-(--portal-border)">
                {myApps.map((a) => (
                  <Link
                    key={a.id}
                    href={`/zapis/${a.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-(--portal-surface-hover) transition"
                  >
                    <div>
                      <p className="text-sm font-medium text-(--portal-text)">
                        {a.dite_jmeno || 'Nová žádost'} {a.dite_prijmeni}
                      </p>
                      <p className="text-xs text-(--portal-text-subtle)">
                        {a.typ === 'zapis' ? 'Zápis' : 'Přestup'} · založeno{' '}
                        {format(new Date(a.created_at), 'd. M. yyyy', { locale: cs })}
                      </p>
                    </div>
                    <StavPill stav={a.stav} />
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {zapisOtevren && (
              <Link
                href="/zapis/nova?typ=zapis"
                className="inline-flex items-center px-5 py-2.5 rounded-lg bg-(--portal-accent)
                  text-white text-sm font-medium hover:opacity-90 transition"
              >
                Nová žádost o zápis
              </Link>
            )}
            <Link
              href="/zapis/nova?typ=prestup"
              className="inline-flex items-center px-5 py-2.5 rounded-lg border border-(--portal-border-md)
                text-(--portal-text) text-sm font-medium hover:bg-(--portal-surface-hover) transition"
            >
              Žádost o přestup
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
