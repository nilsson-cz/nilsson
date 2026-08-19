#!/usr/bin/env node
/**
 * scripts/check-as-any.mjs
 *
 * Ratchet na typový dluh: počet `(supabase as any)` nesmí STOUPNOUT nad baseline.
 * Staré casty jsou grandfathernuté, nové se zablokují → číslo může jen klesat.
 *
 * Spuštění:  npm run check:as-any
 * V CI:      .github/workflows/ci.yml (push/PR na master)
 *
 * Když dluh klesne, sniž BASELINE na vypsané číslo (utáhne se západka).
 *
 * STAV 2026-08-15: burndown DOKONČEN (233 -> 0). Portal dashboard drift vyřešen
 * migrací 078 (get_guardian_unpaid_receivables + get_guardian_bulletin_posts
 * doplněny, casty odstraněny, shapes otypované). Poslední cast lib/matrika.ts
 * (matrika_set_rocnik) odstraněn — po nasazení 078 dal `npm run db:types` do
 * types/database.ts i matrika_set_rocnik (075/076). Baseline 0 = žádný `(supabase
 * as any)` v app/lib/components. Nový cast CI zablokuje.
 *
 * Kořenová příčina dluhu: `types/database.ts` zastarává, protože migrace se
 * pouštějí ručně v Supabase. Nové tabulky nejdřív otypuj `npm run db:types`,
 * teprve pak piš dotazy — ať cast vůbec nevznikne.
 */
import { execSync } from 'node:child_process'

const BASELINE = 0

let out = ''
try {
  out = execSync('git grep -c "supabase as any" -- app lib components', { encoding: 'utf8' })
} catch (e) {
  // git grep vrací exit 1, když nic nenajde → 0 výskytů (žádaný cílový stav)
  out = e.stdout ? String(e.stdout) : ''
}

const count = out
  .trim()
  .split('\n')
  .filter(Boolean)
  .reduce((sum, line) => sum + Number(line.split(':').pop()), 0)

console.log(`(supabase as any): ${count} řádků (baseline ${BASELINE})`)

if (count > BASELINE) {
  console.error(
    `\n❌ Přibyly nové casty (${count} > ${BASELINE}).\n` +
      `   Otypuj nové tabulky přes 'npm run db:types', nebo sniž dluh jinde.\n`,
  )
  process.exit(1)
}

if (count < BASELINE) {
  console.log(
    `\n✅ Dluh klesl o ${BASELINE - count}. ` +
      `Sniž BASELINE v scripts/check-as-any.mjs na ${count}, ať západka drží.\n`,
  )
}
