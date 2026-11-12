/**
 * scripts/abra-probe.ts — průzkum instance ABRA Flexi (F0, TRD-manazerske-ucetnictvi §2.5).
 * Jen čte. Vypíše počet řádků deníku za rok, ukázku řádku, strany zápisu,
 * použité účty tříd 5/6, zakázky a střediska s počty řádků.
 *
 *   npx tsx scripts/abra-probe.ts 2026                       # z env ABRA_URL/ABRA_FIRMA/ABRA_USER/ABRA_PASSWORD
 *   npx tsx scripts/abra-probe.ts 2020 --demo                # veřejná demo instance demo.flexibee.eu
 */

import { abraConfigFromEnv, fetchCiselnik, fetchDenikRok, type AbraConfig } from '../lib/manazerske-ucetnictvi/abra-client'

const rok = Number(process.argv[2] ?? new Date().getFullYear())
const demo = process.argv.includes('--demo')
const cfg: AbraConfig | null = demo
  ? { url: 'https://demo.flexibee.eu', firma: 'demo', user: 'winstrom', password: 'winstrom' }
  : abraConfigFromEnv()

if (!cfg) {
  console.error('Chybí ABRA_URL / ABRA_FIRMA / ABRA_USER / ABRA_PASSWORD (nebo použij --demo).')
  process.exit(1)
}

function top(map: Map<string, { n: number; kc: number }>, limit = 40) {
  return [...map.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, limit)
    .map(([k, v]) => `  ${k.padEnd(14)} ${String(v.n).padStart(6)} ř.  ${Math.round(v.kc).toLocaleString('cs-CZ').padStart(14)} Kč`)
    .join('\n')
}
const bump = (m: Map<string, { n: number; kc: number }>, k: string, kc: number) => {
  const v = m.get(k) ?? { n: 0, kc: 0 }
  v.n++; v.kc += kc; m.set(k, v)
}

async function main() {
  const t0 = Date.now()
  const rows = await fetchDenikRok(cfg!, rok)
  console.log(`Řádků deníku ${rok}: ${rows.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  if (rows.length === 0) return
  console.log('Ukázka:', rows.find((r) => r.md_ucet?.startsWith('5')) ?? rows[0])

  let jenMd = 0, jenDal = 0, obe = 0, zadna = 0, bezDuzp = 0
  const ucty = new Map<string, { n: number; kc: number }>()
  const zak = new Map<string, { n: number; kc: number }>()
  const str = new Map<string, { n: number; kc: number }>()
  const stavy = new Map<string, { n: number; kc: number }>()
  const moduly = new Map<string, { n: number; kc: number }>()
  for (const r of rows) {
    if (r.md_ucet && r.dal_ucet) obe++
    else if (r.md_ucet) jenMd++
    else if (r.dal_ucet) jenDal++
    else zadna++
    if (!r.duzp) bezDuzp++
    for (const [u, sign] of [[r.md_ucet, 1], [r.dal_ucet, -1]] as const) {
      if (u && /^[56]/.test(u)) bump(ucty, `${u} ${sign > 0 ? 'MD' : 'D'}`, r.castka)
    }
    bump(zak, r.zakazka ?? '(bez)', r.castka)
    bump(str, r.stredisko ?? '(bez)', r.castka)
    bump(stavy, `${r.stav ?? '-'} / zuct=${r.zuctovano}`, r.castka)
    bump(moduly, r.modul ?? '-', r.castka)
  }
  console.log(`\nStrany řádku: jen MD ${jenMd}, jen DAL ${jenDal}, obě ${obe}, žádná ${zadna}; bez DUZP ${bezDuzp}`)
  console.log('\nÚčty tříd 5/6:\n' + top(ucty))
  console.log('\nZakázky:\n' + top(zak))
  console.log('\nStřediska:\n' + top(str))
  console.log('\nStav / zaúčtováno:\n' + top(stavy))
  console.log('\nModuly:\n' + top(moduly))

  const zakazky = await fetchCiselnik(cfg!, 'zakazka')
  console.log(`\nČíselník zakázek: ${zakazky.length}`, zakazky.slice(0, 10))
}

main().catch((e) => { console.error(e); process.exit(1) })
