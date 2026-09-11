/**
 * app/dashboard/urazy/[id]/page.tsx
 * Server Component — detail záznamu o úrazu: čtený přehled polí + stavové
 * workflow (kniha úrazů → k odeslání → odesláno ČŠI) + aktualizace.
 *
 * Workflow kroky jsou inline server-action formy (vzor app/dashboard/bozp).
 * Odeslaný záznam je právní dokument — úprava/smazání se blokuje.
 */

import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import {
  URAZ_STAV,
  formatPoradove,
  zranenyCeleJmeno,
  ciselnikLabel,
  CAST_TELA,
  PRICINA,
  DRUH_CINNOSTI,
  MISTO_URAZU,
  PREVENCE,
  type UrazZaznam,
  type UrazAktualizace,
} from '@/lib/urazy'
import {
  setKnihaZapis,
  setKOdeslani,
  confirmOdeslanoCsi,
  deleteUraz,
} from '@/app/actions/urazy'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import AktualizaceForm from './_components/AktualizaceForm'
import NotifyZz from './_components/NotifyZz'

interface PageProps {
  params: Promise<{ id: string }>
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '—'

const fmtDateTime = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('cs-CZ', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

const anoNe = (v: string | null) => (v === 'ano' ? 'ano' : v === 'ne' ? 'ne' : '—')

export default async function UrazDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerClient()

  const { data: z, error } = await supabase
    .from('urazy_zaznam')
    .select('*')
    .eq('id', id)
    .single<UrazZaznam>()

  if (error || !z) notFound()

  const { data: aktualizace } = await supabase
    .from('urazy_aktualizace')
    .select('*')
    .eq('uraz_id', id)
    .order('created_at', { ascending: true })
    .returns<UrazAktualizace[]>()

  const aktList = aktualizace ?? []
  const zamceno = Boolean(z.odeslano_csi_at)

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/urazy" className="hover:text-gray-600 transition-colors">
          Úrazy
        </Link>
        <span aria-hidden>›</span>
        <span className="text-gray-700">{formatPoradove(z.poradove_cislo, z.skolni_rok)}</span>
      </nav>

      {/* Hlavička */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{zranenyCeleJmeno(z)}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              č. {formatPoradove(z.poradove_cislo, z.skolni_rok)} · {fmtDateTime(z.datum_cas)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StavBadge stav={z.stav} />
              {z.je_zaznam && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
                  vzniká záznam o úrazu
                </span>
              )}
              {z.smrtelny && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                  smrtelný
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <a
              href={`/dashboard/urazy/${id}/tiskopis`}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Tiskopis (PDF)
            </a>
            {!zamceno && (
              <Link
                href={`/dashboard/urazy/${id}/upravit`}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Upravit
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Workflow */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Postup</h2>
        <div className="space-y-3">
          {/* Kniha úrazů */}
          <WorkflowStep
            done={Boolean(z.kniha_zapis_at)}
            title="Zápis do knihy úrazů"
            detail={
              z.kniha_zapis_at
                ? `${fmtDate(z.kniha_zapis_at)}${z.kniha_zapis_kdo ? ` · ${z.kniha_zapis_kdo}` : ''}`
                : 'Lhůta: konec následujícího vyučovacího dne'
            }
            action={
              !z.kniha_zapis_at && (
                <StepButton
                  action={async () => {
                    'use server'
                    await setKnihaZapis(id)
                  }}
                  label="Zapsat do knihy"
                />
              )
            }
          />

          {/* Záznam → k odeslání (jen když vzniká záznam) */}
          {z.je_zaznam && (
            <WorkflowStep
              done={z.stav === 'k_odeslani' || Boolean(z.odeslano_csi_at)}
              title="Připravit k odeslání ČŠI"
              detail="Záznam se odesílá do 5. dne následujícího měsíce (zřizovatel + pojišťovna + ČŠI)"
              action={
                z.stav === 'rozepsany' && (
                  <StepButton
                    action={async () => {
                      'use server'
                      await setKOdeslani(id)
                    }}
                    label="Označit k odeslání"
                  />
                )
              }
            />
          )}

          {/* Odesláno ČŠI (ruční potvrzení – Fáze 1) */}
          {z.je_zaznam && (
            <WorkflowStep
              done={Boolean(z.odeslano_csi_at)}
              title="Odesláno do ČŠI / InspIS DATA"
              detail={
                z.odeslano_csi_at
                  ? `Potvrzeno ${fmtDateTime(z.odeslano_csi_at)}`
                  : 'Fáze 1: odešlete ručně v InspIS DATA a potvrďte zde'
              }
              action={
                !z.odeslano_csi_at &&
                (z.stav === 'k_odeslani' || z.stav === 'rozepsany') && (
                  <StepButton
                    action={async () => {
                      'use server'
                      await confirmOdeslanoCsi(id)
                    }}
                    label="Potvrdit odeslání"
                  />
                )
              }
            />
          )}

          {/* Notifikace ZZ */}
          <WorkflowStep
            done={Boolean(z.zz_notifikovan_at)}
            title="Zákonný zástupce informován"
            detail={
              z.zz_notifikovan_at
                ? `Informováno ${fmtDateTime(z.zz_notifikovan_at)}`
                : 'Informování zákonných zástupců o úrazu'
            }
            action={!z.zz_notifikovan_at && <NotifyZz id={id} />}
          />
        </div>
      </section>

      {/* Údaje záznamu */}
      <section className="mb-6 space-y-6">
        <FieldGroup title="Zraněný">
          <Row label="Jméno a příjmení" value={zranenyCeleJmeno(z)} />
          <Row label="Datum narození" value={fmtDate(z.zraneny_datum_narozeni)} />
          <Row label="Ročník" value={z.zraneny_rocnik != null ? String(z.zraneny_rocnik) : '—'} />
          <Row label="Trvalý pobyt" value={adresa(z.zraneny_ulice, z.zraneny_psc, z.zraneny_obec)} />
        </FieldGroup>

        <FieldGroup title="Zákonný zástupce">
          <Row label="Jméno a příjmení" value={z.zz_jmeno ?? '—'} />
          <Row label="Adresa" value={adresa(z.zz_ulice, z.zz_psc, z.zz_obec)} />
        </FieldGroup>

        <FieldGroup title="Úraz a okolnosti">
          <Row label="Datum a čas" value={fmtDateTime(z.datum_cas)} />
          <Row label="ZZ vyrozuměn" value={anoNe(z.zz_vyrozumen)} />
          <Row label="Smrtelný úraz" value={z.smrtelny ? 'ano' : 'ne'} />
          <Row label="Zdravotnické zařízení" value={z.zdravotnicke_zarizeni ?? '—'} />
          <Row label="Popis události" value={z.popis_udalosti ?? '—'} multiline />
          <Row label="Zraněná část těla" value={ciselnikLabel(CAST_TELA, z.cast_tela) || '—'} />
          <Row label="Předpokládaná příčina" value={ciselnikLabel(PRICINA, z.pricina) || '—'} />
          <Row label="Druh činnosti" value={ciselnikLabel(DRUH_CINNOSTI, z.druh_cinnosti) || '—'} />
          <Row label="Místo úrazu" value={ciselnikLabel(MISTO_URAZU, z.misto_urazu) || '—'} />
          <Row label="Preventivní opatření" value={ciselnikLabel(PREVENCE, z.prevence) || '—'} />
          <Row label="Zavinění" value={anoNe(z.zavineni)} />
        </FieldGroup>

        <FieldGroup title="Svědci a dohled">
          <Row label="Svědek" value={z.svedek1 ?? '—'} />
          <Row label="Datum sepsání" value={fmtDate(z.datum_sepsani)} />
          <Row label="Dohled" value={jmenoFunkce(z.dohled_jmeno, z.dohled_funkce)} />
          <Row
            label="Přímo nadřízený"
            value={jmenoFunkce(z.dohled_nadrizeny_jmeno, z.dohled_nadrizeny_funkce)}
          />
        </FieldGroup>

        <FieldGroup title="Povinnost záznamu">
          <Row
            label="Vzniká záznam o úrazu"
            value={z.je_zaznam ? 'ano (formulář dle §2)' : 'ne (stačí kniha úrazů)'}
          />
          <Row
            label="Předpokládaná nepřítomnost"
            value={z.dny_nepritomnosti != null ? `${z.dny_nepritomnosti} dní` : '—'}
          />
          <Row label="Nárok na náhradu (bolest/ZSU)" value={z.narok_nahrada ? 'ano' : 'ne'} />
          {z.poznamka && <Row label="Poznámka" value={z.poznamka} multiline />}
        </FieldGroup>
      </section>

      {/* Aktualizace */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Aktualizace záznamu
        </h2>

        {aktList.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 mb-4">
            {aktList.map((a) => (
              <div key={a.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-gray-900">{fmtDate(a.datum_sepsani)}</p>
                <p className="text-gray-600 mt-0.5">
                  {[
                    a.nahrada_bolest != null && `náhrada za bolest: ${a.nahrada_bolest ? 'ano' : 'ne'}`,
                    a.nahrada_zsu != null && `náhrada za ZSU: ${a.nahrada_zsu ? 'ano' : 'ne'}`,
                    a.smrtelny != null && `úmrtí v důsledku úrazu: ${a.smrtelny ? 'ano' : 'ne'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
                {a.poznamka && <p className="text-gray-500 mt-1">{a.poznamka}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-4">Žádné aktualizace.</p>
        )}

        <AktualizaceForm urazId={id} />
      </section>

      {/* Smazání – jen dokud nebyl odeslán */}
      {!zamceno && (
        <section className="border-t border-gray-100 pt-5">
          <form
            action={async () => {
              'use server'
              const r = await deleteUraz(id)
              if (r.success) redirect('/dashboard/urazy')
            }}
          >
            <button
              type="submit"
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              Smazat záznam
            </button>
          </form>
        </section>
      )}
    </div>
  )
}

// ── Prezentační pomocníci ──────────────────────────────────────────────────

function adresa(ulice: string | null, psc: string | null, obec: string | null): string {
  const parts = [ulice, [psc, obec].filter(Boolean).join(' ')].filter((p) => p && p.length > 0)
  return parts.length > 0 ? parts.join(', ') : '—'
}

function jmenoFunkce(jmeno: string | null, funkce: string | null): string {
  if (!jmeno && !funkce) return '—'
  return [jmeno, funkce].filter(Boolean).join(' · ')
}

function StavBadge({ stav }: { stav: UrazZaznam['stav'] }) {
  const tint: Record<string, string> = {
    rozepsany: 'bg-gray-100 text-gray-600',
    k_odeslani: 'bg-amber-100 text-amber-700',
    odeslano_csi: 'bg-green-100 text-green-700',
    aktualizovano: 'bg-blue-100 text-blue-700',
  }
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        tint[stav] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {URAZ_STAV[stav]}
    </span>
  )
}

function WorkflowStep({
  done,
  title,
  detail,
  action,
}: {
  done: boolean
  title: string
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs ${
          done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
        }`}
        aria-hidden
      >
        {done ? '✓' : '○'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        {detail && <p className="text-xs text-gray-500 mt-0.5">{detail}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** Tlačítko jednoho workflow kroku — forma s inline server action (vzor bozp). */
function StepButton({ action, label }: { action: () => void | Promise<void>; label: string }) {
  return (
    <form action={action}>
      <button
        type="submit"
        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
      >
        {label}
      </button>
    </form>
  )
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</h3>
      <dl className="space-y-2.5 text-sm">{children}</dl>
    </div>
  )
}

function Row({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? '' : 'flex gap-4 items-baseline'}>
      <dt className={`text-gray-400 ${multiline ? 'text-xs uppercase tracking-wide font-medium mb-0.5' : 'w-44 shrink-0'}`}>
        {label}
      </dt>
      <dd className={`text-gray-800 ${multiline ? 'whitespace-pre-wrap' : 'flex-1'}`}>{value}</dd>
    </div>
  )
}
