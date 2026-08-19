// lib/usage-monitor.ts
// Provozní monitoring infrastruktury (Fáze 1) — adaptéry služeb + čistá logika.
//
// Adaptéry (fetch) jsou defenzivní: jakákoli odchylka tvaru odpovědi / chyba sítě
// → vrátí metriku s ok=false místo výjimky, aby jeden rozbitý adaptér neshodil
// celý cron. Čisté funkce (evaluate*, buildAlertMessage) jsou bez side-efektů,
// testovatelné samostatně.
//
// Aktivní: Supabase, GitHub Actions. (Cloudflare vyřazen — doména běží na Forpsi
// DNS + Vercel edge, žádná CF zóna. Railway vyřazen — billing API vyžaduje
// account/workspace auth s vratkým nedokumentovaným schématem; nestálo to za to.)
// Resend + Vercel = Fáze 2.

// ─── Typy ────────────────────────────────────────────────────────────────────

export type ServiceMetric = {
  service: string
  metric: string
  value: number | null
  unit: string | null
  /** Limit, který adaptér zná sám (např. GitHub included_minutes). Jinak null. */
  limitValue: number | null
  ok: boolean
  note?: string
}

export type ThresholdRow = {
  service: string
  metric: string
  label: string | null
  unit: string | null
  manual_limit: number | null
  warn_ratio: number
  crit_ratio: number
  enabled: boolean
}

export type Level = 'ok' | 'warn' | 'crit' | 'info' | 'error'

export type EvaluatedMetric = ServiceMetric & {
  /** Efektivní limit = limit z API, jinak ruční fallback z prahu. */
  effectiveLimit: number | null
  ratio: number | null
  level: Level
  label: string
}

// ─── Čistá logika: vyhodnocení prahů ─────────────────────────────────────────

/**
 * Spojí naměřenou metriku s její konfigurací prahů a vypočte úroveň.
 *   - adaptér selhal (ok=false)                → 'error'
 *   - není limit (API ani ruční)               → 'info' (jen trend, nealertuje)
 *   - alerting vypnutý v prahu (enabled=false) → 'info'
 *   - ratio >= crit_ratio                      → 'crit'
 *   - ratio >= warn_ratio                      → 'warn'
 *   - jinak                                    → 'ok'
 *
 * Priorita limitu: limit z API vítězí, ruční `manual_limit` je jen fallback,
 * kde ho API nevrací (Supabase, GitHub) — viz PRD §4.
 */
export function evaluateMetric(m: ServiceMetric, t: ThresholdRow | undefined): EvaluatedMetric {
  const label = t?.label ?? `${m.service} · ${m.metric}`
  const unit = m.unit ?? t?.unit ?? null
  const base: EvaluatedMetric = {
    ...m,
    unit,
    effectiveLimit: null,
    ratio: null,
    level: 'ok',
    label,
  }

  if (!m.ok || m.value === null) {
    return { ...base, level: 'error' }
  }

  const effectiveLimit = m.limitValue ?? t?.manual_limit ?? null
  if (effectiveLimit === null || effectiveLimit <= 0) {
    return { ...base, effectiveLimit: null, ratio: null, level: 'info' }
  }

  const ratio = m.value / effectiveLimit
  const alertingOn = t?.enabled !== false
  let level: Level = 'ok'
  if (alertingOn) {
    const warn = t?.warn_ratio ?? 0.8
    const crit = t?.crit_ratio ?? 0.95
    if (ratio >= crit) level = 'crit'
    else if (ratio >= warn) level = 'warn'
  } else {
    level = 'info'
  }

  return { ...base, effectiveLimit, ratio, level }
}

/** Vyhodnotí všechny metriky proti mapě prahů (klíč `service|metric`). */
export function evaluateAll(
  metrics: ServiceMetric[],
  thresholds: ThresholdRow[],
): EvaluatedMetric[] {
  const byKey = new Map(thresholds.map((t) => [`${t.service}|${t.metric}`, t]))
  return metrics.map((m) => evaluateMetric(m, byKey.get(`${m.service}|${m.metric}`)))
}

// ─── Čistá logika: sestavení Discord alertu ──────────────────────────────────

const SERVICE_LABEL: Record<string, string> = {
  supabase: 'Supabase',
  github: 'GitHub Actions',
}

function fmtPct(ratio: number): string {
  return `${Math.round(ratio * 100)} %`
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(n)
}

/**
 * Sestaví jednu souhrnnou zprávu jen z metrik v úrovni warn/crit.
 * Vrací null, když není co hlásit (žádný alert se neposílá — low-noise).
 * Selhané adaptéry (error) hlásí zvlášť jako upozornění na slepé místo monitoringu.
 */
export function buildAlertMessage(evaluated: EvaluatedMetric[]): string | null {
  const crit = evaluated.filter((e) => e.level === 'crit')
  const warn = evaluated.filter((e) => e.level === 'warn')
  const errored = evaluated.filter((e) => e.level === 'error')

  if (crit.length === 0 && warn.length === 0 && errored.length === 0) return null

  const line = (e: EvaluatedMetric): string => {
    const svc = SERVICE_LABEL[e.service] ?? e.service
    const unit = e.unit ? ` ${e.unit}` : ''
    const val = e.value !== null ? fmtNum(e.value) : '?'
    const lim = e.effectiveLimit !== null ? ` / ${fmtNum(e.effectiveLimit)}${unit}` : ''
    const pct = e.ratio !== null ? ` (${fmtPct(e.ratio)})` : ''
    return `**${svc}** — ${e.label}: ${val}${lim}${pct}`
  }

  const parts: string[] = ['📊 **Provoz služeb — upozornění**']

  if (crit.length > 0) {
    parts.push('', '🔴 **Kritické (blízko limitu):**', ...crit.map((e) => `• ${line(e)}`))
  }
  if (warn.length > 0) {
    parts.push('', '🟠 **Zvýšené:**', ...warn.map((e) => `• ${line(e)}`))
  }
  if (errored.length > 0) {
    parts.push(
      '',
      '⚪ **Nedostupné (adaptér selhal — kvótu nevidíme):**',
      ...errored.map((e) => `• **${SERVICE_LABEL[e.service] ?? e.service}** — ${e.label}${e.note ? `: ${e.note}` : ''}`),
    )
  }

  return parts.join('\n')
}

// ─── Adaptéry služeb (fetch, defenzivní) ─────────────────────────────────────

const BYTES_PER_MB = 1024 * 1024

/** Bezpečně vrátí metriku selhání s poznámkou. */
function fail(service: string, metric: string, unit: string | null, note: string): ServiceMetric {
  return { service, metric, value: null, unit, limitValue: null, ok: false, note }
}

/**
 * GitHub Actions — Enhanced Billing Platform: usage report za aktuální měsíc.
 * Endpoint: GET /users/{user}/settings/billing/usage?year&month
 * (legacy /settings/billing/actions byl 2025 zrušen → 410 "endpoint has been moved").
 *
 * Env: GH_BILLING_TOKEN, GH_USER.
 * Token: **classic** PAT se scope `user`, vlastněný uživatelem GH_USER.
 *   Enhanced-billing endpoint NEPODPORUJE fine-grained PAT (→ 403).
 *
 * Hodnota = součet spotřebovaných Actions minut (product=actions, unitType=Minutes)
 * napříč SKU (Linux/Windows/macOS) i repozitáři. Pozn.: `quantity` jsou surové
 * minuty, ne násobené kvótové (Win 2×, macOS 10×) — u účtu s běhy jen na Linuxu
 * to sedí 1:1. Limit API nevrací → padá na ruční manual_limit z prahu (2000).
 */
export async function fetchGithub(env: NodeJS.ProcessEnv): Promise<ServiceMetric[]> {
  const token = env.GH_BILLING_TOKEN
  const user = env.GH_USER
  if (!token || !user) {
    return [fail('github', 'ci_minutes_month', 'minutes', 'chybí GH_BILLING_TOKEN / GH_USER')]
  }
  const now = new Date()
  const url = `https://api.github.com/users/${encodeURIComponent(user)}/settings/billing/usage`
    + `?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) {
      // GitHub vrací u chyb JSON s polem `message` (např. proč 403) — vytáhneme ho
      // do poznámky, ať je důvod vidět přímo v dlaždici, ne jen holý stavový kód.
      const body = await res.text().catch(() => '')
      let reason = ''
      try { reason = (JSON.parse(body) as { message?: string }).message ?? '' } catch { /* není JSON */ }
      const detail = reason ? `: ${reason.slice(0, 160)}` : ''
      return [fail('github', 'ci_minutes_month', 'minutes', `HTTP ${res.status}${detail}`)]
    }
    const json: any = await res.json()
    const items: any[] = Array.isArray(json?.usageItems) ? json.usageItems : []
    const minutes = items.reduce((acc, it) => {
      const isActions = String(it?.product ?? '').toLowerCase() === 'actions'
      const isMinutes = String(it?.unitType ?? '').toLowerCase() === 'minutes'
      return isActions && isMinutes ? acc + Number(it?.quantity ?? 0) : acc
    }, 0)
    if (!Number.isFinite(minutes)) {
      return [fail('github', 'ci_minutes_month', 'minutes', 'neočekávaný tvar odpovědi (usageItems)')]
    }
    return [{
      service: 'github',
      metric: 'ci_minutes_month',
      value: minutes,
      unit: 'minutes',
      limitValue: null, // enhanced billing nevrací included_minutes → fallback na manual_limit
      ok: true,
    }]
  } catch (e) {
    return [fail('github', 'ci_minutes_month', 'minutes', e instanceof Error ? e.message : 'fetch error')]
  }
}

/**
 * Supabase — velikost DB přes RPC usage_db_size() (migrace 067).
 * Bez Management API tokenu: cron používá service_role klient (predané `rpc`).
 * @param rpc  funkce volající usage_db_size → vrací bajty (nebo hodí výjimku)
 */
export async function fetchSupabase(rpc: () => Promise<number>): Promise<ServiceMetric[]> {
  try {
    const bytes = await rpc()
    if (!Number.isFinite(bytes)) {
      return [fail('supabase', 'db_size_mb', 'MB', 'RPC nevrátilo číslo')]
    }
    return [{ service: 'supabase', metric: 'db_size_mb', value: bytes / BYTES_PER_MB, unit: 'MB', limitValue: null, ok: true }]
  } catch (e) {
    return [fail('supabase', 'db_size_mb', 'MB', e instanceof Error ? e.message : 'RPC error')]
  }
}
