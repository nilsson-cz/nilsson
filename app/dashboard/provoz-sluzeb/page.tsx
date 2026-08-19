/**
 * app/dashboard/provoz-sluzeb/page.tsx
 * Server Component — director-only: přehled kvót a zdraví infrastruktury (Fáze 1).
 *
 * Čte poslední snapshoty z usage_snapshots (plní denní cron usage-snapshot) a
 * konfiguraci prahů z usage_thresholds. Aktivní metriky: Supabase, GitHub Actions.
 * (Cloudflare + Railway vyřazeny — viz lib/usage-monitor.ts.) Resend + Vercel = Fáze 2.
 *
 * Guard: jen director (RLS director-only navíc vynucuje DB). Tabulky nejsou
 * v types/database.ts → supabase.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { evaluateMetric, type ServiceMetric, type ThresholdRow as ThresholdConfig, type Level } from '@/lib/usage-monitor'
import ThresholdRow from './_components/ThresholdRow'

export const metadata = { title: 'Provoz služeb — IS Nilsson' }
export const dynamic = 'force-dynamic'

const SERVICE_LABEL: Record<string, string> = {
  supabase: 'Supabase',
  github: 'GitHub Actions',
}

/** Adaptéry, které limit hlásí samy (ruční limit se u nich needituje).
 *  Prázdné: GitHub enhanced-billing endpoint už included_minutes nevrací,
 *  takže limit u všech metrik řídí ruční manual_limit z prahu. */
const API_PROVIDES_LIMIT = new Set<string>()

type SnapshotRow = {
  service: string
  metric: string
  value: number | null
  unit: string | null
  limit_value: number | null
  ratio: number | null
  ok: boolean
  note: string | null
  captured_at: string
}

const LEVEL_BADGE: Record<Level, { cls: string; label: string }> = {
  crit:  { cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',           label: 'Kritické' },
  warn:  { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',   label: 'Zvýšené' },
  ok:    { cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', label: 'OK' },
  info:  { cls: 'bg-gray-100 text-gray-500 dark:bg-stone-800 dark:text-stone-400',      label: 'Info' },
  error: { cls: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',    label: 'Nedostupné' },
}

function fmtNum(n: number | null): string {
  if (n === null) return '—'
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(n)
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default async function ProvozSluzebPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  if ((me as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Provoz služeb</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  // Prahy (katalog metrik) + poslední snapshoty za posledních 14 dní.
  const since = new Date(Date.now() - 14 * 86400_000).toISOString()
  const [{ data: thrRaw }, { data: snapRaw }] = await Promise.all([
    supabase.from('usage_thresholds')
      .select('service, metric, label, unit, manual_limit, warn_ratio, crit_ratio, enabled, poradi')
      .order('poradi'),
    supabase.from('usage_snapshots')
      .select('service, metric, value, unit, limit_value, ratio, ok, note, captured_at')
      .gte('captured_at', since)
      .order('captured_at', { ascending: false }),
  ])

  const thresholds = (thrRaw ?? []) as (ThresholdConfig & { poradi: number })[]
  const snapshots = (snapRaw ?? []) as SnapshotRow[]

  // Poslední + předchozí snapshot na klíč service|metric (řazeno desc → [0]=poslední).
  const latest = new Map<string, SnapshotRow>()
  const previous = new Map<string, SnapshotRow>()
  for (const s of snapshots) {
    const k = `${s.service}|${s.metric}`
    if (!latest.has(k)) latest.set(k, s)
    else if (!previous.has(k)) previous.set(k, s)
  }

  const lastCaptured = snapshots[0]?.captured_at ?? null

  // Řádky přehledu = katalog prahů + navázaný poslední snapshot.
  const rows = thresholds.map((t) => {
    const key = `${t.service}|${t.metric}`
    const snap = latest.get(key)
    const prev = previous.get(key)
    const evaluated = snap
      ? evaluateMetric(
          { service: t.service, metric: t.metric, value: snap.value, unit: snap.unit, limitValue: snap.limit_value, ok: snap.ok, note: snap.note ?? undefined } as ServiceMetric,
          t,
        )
      : null
    // Trend jen když obě měření dávají smysl.
    let trend: 'up' | 'down' | 'flat' | null = null
    if (snap?.ok && snap.value !== null && prev?.ok && prev.value !== null) {
      trend = snap.value > prev.value ? 'up' : snap.value < prev.value ? 'down' : 'flat'
    }
    return { t, snap, evaluated, trend }
  })

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">← Správa školy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Provoz služeb</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Kvóty a zdraví infrastruktury — sběr jednou denně.{' '}
          {lastCaptured
            ? <>Naposledy měřeno <span className="font-medium">{fmtDatetime(lastCaptured)}</span>.</>
            : <span className="text-amber-600">Zatím bez měření — cron ještě neproběhl nebo nejsou nastaveny tokeny služeb.</span>}
        </p>
      </div>

      {/* ── Přehled stavu ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-900">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Metrika</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Hodnota</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Limit</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Využití</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Trend</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Stav</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {rows.map(({ t, snap, evaluated, trend }) => {
                const level: Level | null = evaluated?.level ?? null
                const badge = level ? LEVEL_BADGE[level] : null
                const unit = snap?.unit ?? t.unit ?? ''
                const ratio = evaluated?.ratio ?? null
                return (
                  <tr key={`${t.service}|${t.metric}`} className="hover:bg-gray-50 dark:hover:bg-stone-800/50 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-900 dark:text-stone-100">{t.label ?? t.metric}</span>
                      <span className="ml-2 text-xs text-gray-400">{SERVICE_LABEL[t.service] ?? t.service}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                      {snap ? `${fmtNum(snap.value)}${unit ? ` ${unit}` : ''}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-gray-500">
                      {evaluated?.effectiveLimit != null ? `${fmtNum(evaluated.effectiveLimit)}${unit ? ` ${unit}` : ''}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 w-40">
                      {ratio != null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-gray-100 dark:bg-stone-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${level === 'crit' ? 'bg-red-500' : level === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-gray-500 w-10 text-right">{Math.round(ratio * 100)} %</span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">bez limitu</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {trend === 'up' ? <span className="text-gray-500" title="roste">↑</span>
                        : trend === 'down' ? <span className="text-gray-500" title="klesá">↓</span>
                        : trend === 'flat' ? <span className="text-gray-300" title="beze změny">→</span>
                        : <span className="text-gray-200">·</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {badge ? (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`} title={snap?.note ?? undefined}>
                          {badge.label}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Zatím neměřeno</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">
          „Info" = metrika bez tvrdého limitu (sleduje se jen trend). „Nedostupné" = adaptér při posledním běhu selhal
          (najeď na štítek pro detail). Alerty na Discord chodí jen u metrik se zapnutým prahem při úrovni Zvýšené/Kritické.
        </p>
      </section>

      {/* ── Prahy a limity ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="border-t border-gray-100 dark:border-stone-800 pt-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-stone-100">Prahy a limity</h2>
          <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
            Ruční limit uprav tam, kde ho API nehlásí (Supabase, GitHub) — např. podle svého tarifu.
            Poměry zadej v procentech; kritický ≥ upozornění.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-900">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Metrika</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Ruční limit</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Upozornění</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Kritické</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Alert</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
              {thresholds.map((t) => (
                <ThresholdRow
                  key={`${t.service}|${t.metric}`}
                  service={t.service}
                  metric={t.metric}
                  label={t.label ?? t.metric}
                  unit={t.unit}
                  serviceLabel={SERVICE_LABEL[t.service] ?? t.service}
                  manualLimit={t.manual_limit}
                  warnRatio={t.warn_ratio}
                  critRatio={t.crit_ratio}
                  enabled={t.enabled}
                  apiProvidesLimit={API_PROVIDES_LIMIT.has(`${t.service}|${t.metric}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
