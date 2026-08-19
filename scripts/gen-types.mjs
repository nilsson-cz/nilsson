#!/usr/bin/env node
/**
 * scripts/gen-types.mjs
 *
 * Bezpečná regenerace types/database.ts z živé Supabase DB.
 *
 * Proč wrapper a ne prostý `... > types/database.ts`:
 *   1. `>` přepíše (vyprázdní) soubor JEŠTĚ PŘED během — když gen selže
 *      (nepřihlášeno / nelinknuto / interaktivní prompt), zůstane rozbitý soubor.
 *   2. `npx supabase` bez `--yes` visí na promptu „Ok to proceed?" a drží zámek.
 * Tenhle skript generuje do paměti, ověří validitu a soubor přepíše AŽ při úspěchu.
 *
 * Prereq (jednorázově):
 *   npx --yes supabase login
 *   npx --yes supabase link --project-ref <REF>   # REF z dashboardu, ne "Nilsson"
 *
 * Spuštění:  npm run db:types   (pak zkontroluj `git diff types/database.ts`)
 */
import { execSync } from 'node:child_process'
import { writeFileSync, statSync } from 'node:fs'

const TARGET = 'types/database.ts'
const CMD = 'npx --yes supabase gen types typescript --linked --schema public,web'

let out = ''
try {
  out = execSync(CMD, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'], // stdin ignore = žádný hang na promptu
    maxBuffer: 64 * 1024 * 1024,
  })
} catch {
  console.error(
    '\n❌ `supabase gen types` selhalo — ' + TARGET + ' NEZMĚNĚN.\n' +
      '   Zkontroluj přihlášení a link:\n' +
      '     npx --yes supabase login\n' +
      '     npx --yes supabase link --project-ref <REF>\n',
  )
  process.exit(1)
}

// Sanity check výstupu — ať se do souboru nikdy nedostane prompt/půlka/prázdno.
if (!out.includes('export type Database') || out.length < 1000) {
  console.error(
    '\n❌ Výstup nevypadá jako validní typy (chybí `export type Database` / je krátký).\n' +
      '   ' + TARGET + ' NEZMĚNĚN. Prvních 200 znaků výstupu:\n' +
      '   ' + JSON.stringify(out.slice(0, 200)) + '\n',
  )
  process.exit(1)
}

writeFileSync(TARGET, out)
const lines = out.split('\n').length
console.log(`\n✅ ${TARGET} zregenerován (${lines} řádků, ${statSync(TARGET).size} B).`)
console.log('   Zkontroluj: git diff types/database.ts\n')
