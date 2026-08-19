// lib/school-year.ts
// Server resolver školního roku pro přehled žáků (/dashboard/zaci).
//
// Zdroj pravdy = singleton tabulka school_year_config (migrace 073):
//   active_year   NULL → auto-výpočet z data (okno 1.9.–31.8.), jinak override
//   visible_years NULL → auto (roky z groups), jinak výběr ředitele
//
// Rozsah: zatím řídí jen stránku žáků. Zbytek IS stále používá konstanty
// z lib/config.ts (CURRENT_SCHOOL_YEAR aj.) — případná centralizace = pozdější
// krok. Konstanta slouží i jako bezpečný fallback při chybě čtení configu.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

/**
 * Vypočte školní rok pro dané datum. Okno: 1.9.–31.8. následujícího roku.
 * Např. 12.8.2026 → '2025/2026', 1.9.2026 → '2026/2027'.
 */
export function computeSchoolYear(d: Date): string {
  const y = d.getFullYear()
  // getMonth() je 0-based: srpen = 7, září = 8.
  return d.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`
}

/** Následující školní rok: '2026/2027' → '2027/2028'. */
export function nextSchoolYear(y: string): string {
  const [a, b] = y.split('/').map((n) => parseInt(n, 10))
  return `${a + 1}/${b + 1}`
}

type ConfigRow = { active_year: string | null; visible_years: string[] | null }

async function readConfig(): Promise<ConfigRow | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('school_year_config')
      .select('active_year, visible_years')
      .eq('id', 1)
      .maybeSingle()
    if (error) {
      console.error('[school-year] readConfig error:', error.message)
      return null
    }
    return (data as ConfigRow) ?? null
  } catch (e) {
    console.error('[school-year] readConfig throw:', e)
    return null
  }
}

/**
 * Aktivní školní rok. active_year z configu, jinak auto-výpočet z dnešního data.
 * Fallback na CURRENT_SCHOOL_YEAR při selhání čtení configu.
 */
export async function getActiveSchoolYear(): Promise<string> {
  const cfg = await readConfig()
  if (cfg === null) return CURRENT_SCHOOL_YEAR
  return cfg.active_year ?? computeSchoolYear(new Date())
}

/**
 * Roky zobrazované na přehledu žáků. visible_years z configu, jinak auto:
 * všechny roky, pro které existují třídy (groups), sestupně = „proběhlé +
 * nadcházející". Aktivní rok je vždy součástí seznamu.
 */
export async function getVisibleSchoolYears(): Promise<string[]> {
  const [cfg, active] = await Promise.all([readConfig(), getActiveSchoolYear()])

  let years: string[] = []
  if (cfg?.visible_years && cfg.visible_years.length > 0) {
    years = [...cfg.visible_years]
  } else {
    try {
      const supabase = await createSupabaseServerClient()
      const { data } = await supabase
        .from('groups')
        .select('school_year')
      years = Array.from(
        new Set(((data as { school_year: string }[]) ?? []).map((g) => g.school_year))
      )
    } catch (e) {
      console.error('[school-year] getVisibleSchoolYears throw:', e)
    }
  }

  if (!years.includes(active)) years.push(active)
  // Sestupně (nejnovější první), stejné řazení jako api/groups.
  return years.sort((a, b) => b.localeCompare(a))
}
