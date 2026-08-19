'use server'

// app/actions/usage-monitor.ts
// Správa prahů provozního monitoringu (usage_thresholds).
// Zápis vynucuje RLS (is_director()). Tabulka je v types/database.ts (regen 2026-08-10).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type Result = { ok?: true; error?: string }

/** Prázdné/whitespace → null; jinak nezáporné číslo, nebo chyba. */
function parseLimit(raw: string): number | null | 'invalid' {
  const v = raw.trim()
  if (v === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : 'invalid'
}

/** Poměr 0–1 (přijímá i procenta 1–100 → převede). */
function parseRatio(raw: string): number | 'invalid' {
  const v = raw.trim().replace(',', '.')
  let n = Number(v)
  if (!Number.isFinite(n)) return 'invalid'
  if (n > 1) n = n / 100
  return n > 0 && n <= 1 ? n : 'invalid'
}

/**
 * Upraví práh jedné metriky: ruční limit + warn/crit poměry + zapnutí alertů.
 * `service`/`metric` identifikují existující řádek (upsert na UNIQUE dvojici).
 */
export async function setUsageThreshold(input: {
  service: string
  metric: string
  manualLimit: string
  warnRatio: string
  critRatio: string
  enabled: boolean
}): Promise<Result> {
  const { service, metric } = input
  if (!service || !metric) return { error: 'Chybí identifikace metriky.' }

  const limit = parseLimit(input.manualLimit)
  if (limit === 'invalid') return { error: 'Ruční limit musí být nezáporné číslo (nebo prázdné).' }

  const warn = parseRatio(input.warnRatio)
  if (warn === 'invalid') return { error: 'Práh upozornění musí být 1–100 % (nebo 0–1).' }

  const crit = parseRatio(input.critRatio)
  if (crit === 'invalid') return { error: 'Kritický práh musí být 1–100 % (nebo 0–1).' }

  if (crit < warn) return { error: 'Kritický práh nesmí být nižší než práh upozornění.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('usage_thresholds')
    .update({
      manual_limit: limit,
      warn_ratio: warn,
      crit_ratio: crit,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('service', service)
    .eq('metric', metric)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/provoz-sluzeb')
  return { ok: true }
}
