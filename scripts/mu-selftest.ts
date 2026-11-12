/**
 * scripts/mu-selftest.ts — kontrola čistých funkcí modulu Manažerské účetnictví
 * na syntetických datech (bez DB).   npx tsx scripts/mu-selftest.ts
 */

import assert from 'node:assert/strict'
import { relCode, flexiDate, parseDenikRow } from '../lib/manazerske-ucetnictvi/abra-client'
import { rozlozRadek, vyberPravidlo, zaradit, periodRadku, radekPlati, type MuPravidlo, type AbraRadekZarazeni } from '../lib/manazerske-ucetnictvi/zarazeni'
import { bilanceBy, celkem, cilKey, cinnostiZPlateb, faktyAbra, faktyPlatby, faktyDotace, faktyPreuctovani, poKategorie, polozkyAbraVypis, presunPo, type MuKody } from '../lib/manazerske-ucetnictvi/fakty'
import { resolveMuRange } from '../lib/manazerske-ucetnictvi/report'
import { faktyRezieDoplatek, type MuFakt } from '../lib/manazerske-ucetnictvi/fakty'
import { mesiceSkolnihoRoku, skolniRokZacatek, spocitatCerpani, stavCerpani, type Balik } from '../lib/manazerske-ucetnictvi/cerpani'
import { bankovniDoklady, nezauctovanyDoklad, prijataDotace, sparovat, zustatekUctu, type KontrolaRadek } from '../lib/manazerske-ucetnictvi/kontrola'
import {
  pololetiMesice, pololetiMesic, skolniRokMesice, prispevekSj, vypocetRezie, souhrnPololeti, popisDavky, zaokrouhlitPohledavku,
} from '../lib/manazerske-ucetnictvi/obedy-rezie'
import { kopirovatPlan, navrhDotaci, oknoMesice, planBilanceBy, rozpocitat, rozpoznatSablonu } from '../lib/manazerske-ucetnictvi/plan'
import {
  historie, lastDay, nextPeriod, prumerVydaju, sablonaDotaci, vyhled, zustatekKDni,
} from '../lib/manazerske-ucetnictvi/cashflow'

let n = 0
const t = (name: string, fn: () => void) => { fn(); n++; console.log('✓', name) }

const P = (o: Partial<MuPravidlo> & { id: string; ucet_prefix: string }): MuPravidlo => ({
  zakazka: null, stredisko: null, cinnost_abra: null, cil_cinnost_id: null, cil_akce_id: null,
  kategorie_id: null, vyloucit: false, aktivni: true, ...o,
})
const R = (o: Partial<AbraRadekZarazeni> & { flexi_id: number }): AbraRadekZarazeni & { doklad: string | null } => ({
  dat_ucto: '2026-09-15', duzp: null, md_ucet: null, dal_ucet: null, castka: 0, zakazka: null, stredisko: null,
  cinnost_abra: null, smazano: false, zuctovano: true, doklad: 'FP1', ...o,
})
const kody: MuKody = {
  kategorie: new Map([['mzdy', 'K_MZDY'], ['skolne', 'K_SKOLNE'], ['dotace', 'K_DOT'], ['platby_akce', 'K_AKCE'],
    ['naklady_ostatni', 'K_ON'], ['prijmy_ostatni', 'K_OP'], ['platby_obedy', 'K_OB'], ['platby_druzina', 'K_D']]),
  cinnost: new Map([['skola', 'C_SKOLA'], ['ap', 'C_AP'], ['druzina', 'C_D'], ['obedy', 'C_OB']]),
}

t('abra-client: převody hodnot', () => {
  assert.equal(relCode('code:518100'), '518100')
  assert.equal(relCode(''), null)
  assert.equal(flexiDate('2026-01-01+01:00'), '2026-01-01')
  const r = parseDenikRow({ idUcetniDenik: '10737418261', datUcto: '2020-01-31+01:00', mdUcet: 'code:521001', dalUcet: 'code:331001', sumTuz: '48360.0', zuctovano: 'true', 'idDokl@evidencePath': 'interni-doklad', idDokl: '27' })
  assert.equal(r?.flexi_id, 10737418261)
  assert.equal(r?.castka, 48360)
  assert.equal(r?.md_ucet, '521001')
  assert.equal(r?.evidence_path, 'interni-doklad')
})

t('rozklad stran: MD 5xx +, DAL 5xx − (storno), DAL 6xx výnos +', () => {
  assert.deepEqual(rozlozRadek({ md_ucet: '518100', dal_ucet: '321000', castka: 1000 }).map((p) => [p.typ, p.castka]), [['naklad', 1000]])
  assert.deepEqual(rozlozRadek({ md_ucet: '321000', dal_ucet: '518100', castka: 200 }).map((p) => [p.typ, p.castka]), [['naklad', -200]])
  assert.deepEqual(rozlozRadek({ md_ucet: '311000', dal_ucet: '602001', castka: 50 }).map((p) => [p.typ, p.castka]), [['prijem', 50]])
  assert.equal(rozlozRadek({ md_ucet: '518100', dal_ucet: '548000', castka: 10 }).length, 2)   // přeúčtování 5→5
  assert.equal(rozlozRadek({ md_ucet: '221000', dal_ucet: '311000', castka: 10 }).length, 0)
})

t('priorita pravidel: zakázka přebíjí delší prefix; remíza = konflikt', () => {
  const pr = [
    P({ id: 'b', ucet_prefix: '521', cil_cinnost_id: 'C_SKOLA', kategorie_id: 'K_MZDY' }),
    P({ id: 'a', ucet_prefix: '5', zakazka: 'AP', cil_cinnost_id: 'C_AP', kategorie_id: 'K_MZDY' }),
  ]
  assert.equal(vyberPravidlo(pr, '521001', { zakazka: 'AP', stredisko: null, cinnost_abra: null })?.pravidlo.id, 'a')
  assert.equal(vyberPravidlo(pr, '521001', { zakazka: null, stredisko: null, cinnost_abra: null })?.pravidlo.id, 'b')
  const tie = vyberPravidlo([P({ id: 'y', ucet_prefix: '52' }), P({ id: 'x', ucet_prefix: '52' })], '521', { zakazka: null, stredisko: null, cinnost_abra: null })
  assert.equal(tie?.pravidlo.id, 'x')
  assert.equal(tie?.konflikt, true)
  assert.equal(vyberPravidlo([P({ id: 'z', ucet_prefix: '52', aktivni: false })], '521', { zakazka: null, stredisko: null, cinnost_abra: null }), null)
})

t('implicitní akce podle zakázky; kategorie z pravidla účtu; override má přednost', () => {
  const pr = [P({ id: 'p', ucet_prefix: '501', cil_cinnost_id: 'C_SKOLA', kategorie_id: 'K_SPOTR' })]
  const akce = [{ id: 'A1', abra_zakazka: 'EXP26' }]
  const r = R({ flexi_id: 1, md_ucet: '501001', castka: 300, zakazka: 'EXP26' })
  const pol = rozlozRadek(r)[0]
  const z = zaradit(r, pol, pr, null, akce, { naklad: 'K_ON', prijem: 'K_OP' })
  assert.equal(z.akceId, 'A1'); assert.equal(z.kategorieId, 'K_SPOTR'); assert.equal(z.zdroj, 'akce')
  const z2 = zaradit(R({ flexi_id: 2, md_ucet: '511000', castka: 1, zakazka: 'EXP26' }), { ucet: '511000', strana: 'MD', typ: 'naklad', castka: 1 }, pr, null, akce, { naklad: 'K_ON', prijem: 'K_OP' })
  assert.equal(z2.kategorieId, 'K_ON')
  const ov = { flexi_id: 1, cil_cinnost_id: 'C_D', cil_akce_id: null, kategorie_id: 'K_X', vyloucit: false, period: '2026-08', poznamka: 'x' }
  assert.equal(zaradit(r, pol, pr, ov, akce, { naklad: null, prijem: null }).cinnostId, 'C_D')
  assert.equal(periodRadku(r, ov), '2026-08')
  assert.equal(periodRadku(R({ flexi_id: 3, dat_ucto: '2026-10-02', duzp: '2026-09-30' })), '2026-09')
  assert.equal(radekPlati(R({ flexi_id: 4, zuctovano: false })), false)
})

t('faktyAbra: nezařazeno, storno, vyloučení, nezaúčtované, období', () => {
  const pr = [
    P({ id: 'p1', ucet_prefix: '52', cil_cinnost_id: 'C_SKOLA', kategorie_id: 'K_MZDY' }),
    P({ id: 'p2', ucet_prefix: '551', vyloucit: true }),
  ]
  const radky = [
    R({ flexi_id: 1, md_ucet: '521001', dal_ucet: '331000', castka: 1000 }),
    R({ flexi_id: 2, md_ucet: '331000', dal_ucet: '521001', castka: 100 }),        // storno
    R({ flexi_id: 3, md_ucet: '518000', dal_ucet: '321000', castka: 50 }),         // nezařazeno
    R({ flexi_id: 4, md_ucet: '551000', dal_ucet: '082000', castka: 70 }),         // odpisy vyloučeny
    R({ flexi_id: 5, md_ucet: '521001', dal_ucet: '331000', castka: 9, zuctovano: false }),
    R({ flexi_id: 6, md_ucet: '521001', dal_ucet: '331000', castka: 9, dat_ucto: '2026-11-01' }),  // mimo období
  ]
  const { fakty, stat } = faktyAbra(radky, new Set(['2026-09']), pr, new Map(), [], kody)
  const b = bilanceBy(fakty, (f) => cilKey(f.cil))
  assert.equal(b.get('c:C_SKOLA')?.naklady, 900)
  assert.equal(b.get('n')?.naklady, 50)
  assert.equal(stat.vylouceno, 1)
  assert.equal(stat.vynechanoNezauctovano, 1)
  assert.equal(celkem(fakty).vysledek, -950)
})

t('faktyPlatby: typy, SS bez akce, období ze splatnosti', () => {
  const f = faktyPlatby([
    { id: 'o1', type: 'tuition', amount: 4400, period: '2026-09', due_date: '2026-09-15', ss_kod: '7020260901' },
    { id: 'o2', type: 'event', amount: 3000, period: null, due_date: '2026-09-20', ss_kod: '2020260801' },
    { id: 'o3', type: 'event', amount: 500, period: null, due_date: '2026-09-20', ss_kod: '2020260802' },
    { id: 'o4', type: 'lunch', amount: 540, period: '2026-10', due_date: '2026-11-10', ss_kod: '1020261001' },
  ], new Set(['2026-09']), new Map([['2020260802', 'A9']]), kody)
  assert.equal(f.length, 3)
  assert.deepEqual(f.map((x) => cilKey(x.cil)), ['c:C_SKOLA', 's:2020260801', 'a:A9'])
})

t('faktyDotace: mapování položky na činnost, chybějící nárok vynechán', () => {
  const f = faktyDotace([
    { period: '2026-09', polozkaId: 'P_AP', narok: 20000 },
    { period: '2026-09', polozkaId: 'P_ZS', narok: 300000 },
    { period: '2026-09', polozkaId: 'P_SD', narok: null },
  ], new Map([['P_AP', 'C_AP']]), kody)
  assert.deepEqual(f.map((x) => [cilKey(x.cil), x.castka]), [['c:C_AP', 20000], ['c:C_SKOLA', 300000]])
})

t('resolveMuRange: výchozí školní rok, strop aktuální měsíc', () => {
  const now = new Date('2026-10-18T10:00:00')
  const r = resolveMuRange(undefined, undefined, now)
  assert.equal(r.months.length, 2)   // září + říjen 2026
  assert.deepEqual(r.from, { year: 2026, month: 9 })
  const r2 = resolveMuRange('2026-01', '2027-05', now)
  assert.deepEqual(r2.to, { year: 2026, month: 10 })
  assert.equal(resolveMuRange(undefined, undefined, new Date('2027-03-01T10:00:00')).months.length, 7)
})

t('režie: příklad září z PRD (15 753 − 13 651) / 267', () => {
  const billing = [{ student_id: 'A', meals: 20 }, { student_id: 'B', meals: 247 }, { student_id: 'C', meals: 0 }]
  const v = vypocetRezie(15753, 13651, billing)
  assert.equal(v.obedu, 267)
  assert.equal(v.kRozdeleni, 2102)
  assert.equal(v.naObed, 7.872659)
  assert.equal(v.zaci.length, 2)
  assert.equal(Math.round(v.zaci[0].doplatek * 100) / 100, 157.45)
  assert.equal(vypocetRezie(10000, 12000, billing).naObed, 0)                      // příspěvek > režie → 0
  assert.equal(vypocetRezie(100, 0, [{ student_id: 'A', meals: 0 }]).naObed, 0)    // žádné obědy
})

t('režie: příspěvek KÚ = nárok ŠJ (27 strávníků × 100 % × 6 067 / 12)', () => {
  const narok = Math.round((27 * 1 * 6067) / 12)      // 13 651 — stejně jako ruční tabulka ředitele
  assert.equal(narok, 13651)
  assert.deepEqual(prispevekSj(narok), { castka: 13651, zdroj: 'odhad' })
  assert.deepEqual(prispevekSj(null), { castka: null, zdroj: 'odhad' })
})

t('režie: pololetí, souhrn a zaokrouhlení', () => {
  assert.deepEqual(pololetiMesice('2026/2027', 1), ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'])
  assert.deepEqual(pololetiMesice('2026/2027', 2), ['2027-02', '2027-03', '2027-04', '2027-05', '2027-06'])
  assert.equal(pololetiMesic('2027-01'), 1); assert.equal(pololetiMesic('2027-07'), null); assert.equal(pololetiMesic('2027-02'), 2)
  assert.equal(skolniRokMesice('2027-01'), '2026/2027'); assert.equal(skolniRokMesice('2026-09'), '2026/2027')
  assert.equal(popisDavky('2026/2027', 1), 'Režie obědů 1. pololetí 2026/27')
  assert.equal(zaokrouhlitPohledavku(157.5), 158); assert.equal(zaokrouhlitPohledavku(157.49), 157)
  const s = souhrnPololeti([
    { student_id: 'A', obedu: 20, doplatek: 157.453 }, { student_id: 'A', obedu: 18, doplatek: 140.1 },
    { student_id: 'B', obedu: 0, doplatek: 0.2 },
  ])
  assert.deepEqual(s, [{ student_id: 'A', obedu: 38, presne: 297.553, castka: 298 }])
})

t('fakty: doplatek režie jako příjem Obědů, pohledávky dávky vynechány z Plateb', () => {
  const k = { ...kody, kategorie: new Map([...kody.kategorie, ['rezie_doplatek', 'K_RD']]) }
  const f = faktyRezieDoplatek([{ period: '2026-09', doplatek: 2102.004 }, { period: '2026-08', doplatek: 5 }], new Set(['2026-09']), k)
  assert.deepEqual(f.map((x) => [cilKey(x.cil), x.kategorieId, x.castka]), [['c:C_OB', 'K_RD', 2102]])
  const p = faktyPlatby([{ id: 'o9', type: 'lunch', amount: 298, period: null, due_date: '2026-09-15', ss_kod: '1020270201' }],
    new Set(['2026-09']), new Map(), kody, new Set(['o9']))
  assert.equal(p.length, 0)
})

t('plán: okna, šablony rozpočítání, rozpoznání šablony', () => {
  const sk = oknoMesice('2026/2027')!
  assert.equal(sk[0], '2026-09'); assert.equal(sk[11], '2027-08'); assert.equal(sk.length, 12)
  assert.equal(oknoMesice('2027')![0], '2027-01')
  assert.equal(oknoMesice('2026/2028'), null); assert.equal(oknoMesice('x'), null)
  const r12 = rozpocitat(100000, sk, '12')
  assert.equal(r12.reduce((s, v) => s + v, 0), 100000)
  assert.equal(r12[0], 8333.33); assert.equal(r12[11], 8333.37)                // zbytek do posledního měsíce
  const r10 = rozpocitat(44000, sk, '10')                                        // školné 4 400 × 10
  assert.deepEqual(r10, [4400, 4400, 4400, 4400, 4400, 4400, 4400, 4400, 4400, 4400, 0, 0])
  assert.deepEqual(rozpoznatSablonu(r10, sk), { sablona: '10', rocni: 44000 })
  assert.deepEqual(rozpoznatSablonu(r12, sk), { sablona: '12', rocni: 100000 })
  assert.equal(rozpoznatSablonu([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0], sk).sablona, 'rucne')
})

t('plán: kopie s navýšením a součty po činnostech', () => {
  const b = [
    { period: '2026-09', cinnostId: 'S', kategorieId: 'K_NAJEM', castka: 40000 },
    { period: '2026-09', cinnostId: 'S', kategorieId: 'K_SKOLNE', castka: 132000 },
  ]
  const k = kopirovatPlan(b, 1, 5)
  assert.deepEqual(k.map((x) => [x.period, x.castka]), [['2027-09', 42000], ['2027-09', 138600]])
  const typ = new Map<string, 'prijem' | 'naklad'>([['K_NAJEM', 'naklad'], ['K_SKOLNE', 'prijem']])
  assert.deepEqual(planBilanceBy(b, typ, (x) => x.cinnostId).get('S'), { prijmy: 132000, naklady: 40000, vysledek: 92000 })
})

t('cash-flow: zůstatek k dni ze snapshotu dopředu i dozadu, historie', () => {
  const snaps = [{ datum: '2026-10-15', zustatek: 500000 }]
  const txs = [
    { datum: '2026-09-30', castka: -100000 }, { datum: '2026-10-10', castka: 50000 },
    { datum: '2026-10-16', castka: -20000 }, { datum: '2026-10-18', castka: 30000 },
  ]
  assert.equal(zustatekKDni('2026-10-18', snaps, txs), 510000)             // 500k − 20k + 30k
  assert.equal(zustatekKDni('2026-09-30', snaps, txs), 450000)             // 500k − 50k (10. 10.)
  assert.equal(zustatekKDni('2026-09-29', snaps, txs), 550000)             // + vrácení výdaje 30. 9.
  assert.equal(zustatekKDni('2026-10-01', [], txs), null)
  const h = historie(['2026-09', '2026-10'], snaps, txs, '2026-10-18')
  assert.deepEqual(h.map((x) => [x.period, x.prijmy, x.vydaje, x.zustatek]), [['2026-09', 0, 100000, 450000], ['2026-10', 80000, 20000, 510000]])
  assert.equal(lastDay('2027-02'), '2027-02-28'); assert.equal(nextPeriod('2026-12'), '2027-01'); assert.equal(nextPeriod('2027-01', -1), '2026-12')
  assert.equal(prumerVydaju(txs, '2026-11'), 60000)                        // 9: 100k, 10: 20k → 60k
})

t('cash-flow: výhled — zbytek měsíce, rozpočet vs. faktury, předpisy, minimum v nejhorším scénáři', () => {
  const v = vyhled({
    dnes: '2026-10-18', start: 300000, periods: ['2026-10', '2026-11', '2026-12'],
    pohledavky: [{ splatnost: '2026-10-25', zbyva: 4400 }, { splatnost: '2026-11-15', zbyva: 132000 }],
    predepsano: new Map([['2026-11', 132000]]),
    faktury: [{ splatnost: '2026-10-05', castka: 10000 }, { splatnost: '2026-11-10', castka: 50000 }],
    dotace: [{ datum: '2026-12-15', castka: 400000 }, { datum: '2026-10-01', castka: 999 }],
    planPrijmy: new Map([['2026-11', 140000], ['2026-12', 140000]]),
    planNaklady: new Map([['2026-10', 250000], ['2026-11', 250000]]),          // prosinec bez rozpočtu → průměr
    prumerVydaju: 200000, utracenoTentoMesic: 180000, min: 100000,
  })
  // říjen: pohledávky 4 400; faktura po splatnosti 10 000; plán zbývá 250k − 180k = 70k → −10k faktur = 60k
  assert.deepEqual([v[0].pohledavky, v[0].faktury, v[0].vydajePlan, v[0].poVydajich, v[0].zustatek], [4400, 10000, 60000, 230000, 234400])
  // listopad: příjmy 132k + plán (140k − 132k předepsáno) 8k; výdaje faktura 50k + (250k − 50k)
  // nejhorší scénář: výdaje 1. dne → 234 400 − 250 000 = −15 600 pod minimem, i když konec měsíce (124 400) je nad ním
  assert.deepEqual([v[1].prijmy, v[1].vydaje, v[1].poVydajich, v[1].zustatek, v[1].podMinimem], [140000, 250000, -15600, 124400, true])
  // prosinec: plán příjmů 140k + dotace 400k; výdaje průměr 200k (odhad)
  assert.deepEqual([v[2].prijmy, v[2].vydaje, v[2].vydajeOdhad, v[2].zustatek], [540000, 200000, true, 464400])
  const pod = vyhled({ ...{
    dnes: '2026-10-18', start: 50000, periods: ['2026-11'], pohledavky: [], predepsano: new Map(), faktury: [], dotace: [],
    planPrijmy: new Map(), planNaklady: new Map([['2026-11', 10000]]), prumerVydaju: null, utracenoTentoMesic: 0, min: 45000,
  } })
  assert.deepEqual([pod[0].poVydajich, pod[0].podMinimem], [40000, true])
  // příjem v témže měsíci výpadek nezachrání — dojde až poslední den
  const pila = vyhled({
    dnes: '2026-10-18', start: 50000, periods: ['2026-11'], pohledavky: [{ splatnost: '2026-11-02', zbyva: 30000 }], predepsano: new Map(), faktury: [], dotace: [],
    planPrijmy: new Map(), planNaklady: new Map([['2026-11', 10000]]), prumerVydaju: null, utracenoTentoMesic: 0, min: 45000,
  })
  assert.deepEqual([pila[0].poVydajich, pila[0].zustatek, pila[0].podMinimem], [40000, 70000, true])
})

t('cash-flow: šablona plateb KÚ — kvartálně a provizorium', () => {
  const q = sablonaDotaci('2026-11', '2027-04', 100000, 'kvartalne')
  assert.deepEqual(q.map((r) => [r.datum, r.castka, r.obdobi_od, r.obdobi_do]), [
    ['2027-01-15', 300000, '2027-01', '2027-03'], ['2027-04-15', 300000, '2027-04', '2027-06'],
  ])
  const p = sablonaDotaci('2026-11', '2026-12', 100000, 'provizorium')
  assert.deepEqual(p.map((r) => [r.datum, r.obdobi_od]), [['2026-11-15', '2026-10'], ['2026-12-15', '2026-11']])
})

t('dotace: podpůrná opatření do činnosti PO a vlastní podkategorie (migrace 158)', () => {
  const f = faktyDotace([
    { period: '2026-09', polozkaId: 'P_AP', narok: 20000 },
    { period: '2026-09', polozkaId: 'P_SPEC', narok: 9000 },
    { period: '2026-09', polozkaId: 'P_ZS', narok: 300000 },
  ], new Map([['P_AP', 'C_PO'], ['P_SPEC', 'C_PO']]), kody, new Map([['P_AP', 'K_DOT_AP'], ['P_SPEC', 'K_DOT_SPEC']]))
  assert.deepEqual(f.map((x) => [cilKey(x.cil), x.kategorieId, x.castka]), [
    ['c:C_PO', 'K_DOT_AP', 20000], ['c:C_PO', 'K_DOT_SPEC', 9000], ['c:C_SKOLA', 'K_DOT', 300000],
  ])
})

t('čerpání dotací: skutečnost + výhled z plánu / průměru, stav a tolerance', () => {
  const ap: Balik = { id: 'B_AP', kod: 'po_ap', nazev: 'AP', cinnostId: null, polozkaIds: ['P_AP'], kategorieIds: ['K_MZ_AP'],
    dotaceCile: [{ cinnostId: 'C_PO', kategorieId: 'K_DOT_AP' }] }
  const sk: Balik = { id: 'B_SK', kod: 'skola', nazev: 'Škola', cinnostId: 'C_SKOLA', polozkaIds: ['P_ZS'], kategorieIds: ['K_MZDY', 'K_NAJEM'],
    dotaceCile: [{ cinnostId: 'C_SKOLA', kategorieId: 'K_DOT' }] }
  const { uzavreno, zbyva } = mesiceSkolnihoRoku(2025, '2026-07')
  assert.equal(uzavreno.length, 10); assert.deepEqual([uzavreno[0], uzavreno[9]], ['2025-09', '2026-06']); assert.deepEqual(zbyva, ['2026-07', '2026-08'])
  assert.deepEqual([skolniRokZacatek('2026-08'), skolniRokZacatek('2026-09'), skolniRokZacatek('2027-01')], [2025, 2026, 2026])
  const fakty: MuFakt[] = []
  for (const p of uzavreno) {
    fakty.push({ period: p, cil: { kind: 'cinnost', id: 'C_PO' }, kategorieId: 'K_DOT_AP', typ: 'prijem', zdroj: 'dotace', castka: 20000, ref: { kind: 'vf', id: `${p}|P_AP` } })
    fakty.push({ period: p, cil: { kind: 'cinnost', id: 'C_PO' }, kategorieId: 'K_MZ_AP', typ: 'naklad', zdroj: 'abra', castka: 15000 })
    fakty.push({ period: p, cil: { kind: 'cinnost', id: 'C_SKOLA' }, kategorieId: 'K_DOT', typ: 'prijem', zdroj: 'dotace', castka: 300000, ref: { kind: 'vf', id: `${p}|P_ZS` } })
    fakty.push({ period: p, cil: { kind: 'cinnost', id: 'C_SKOLA' }, kategorieId: 'K_MZDY', typ: 'naklad', zdroj: 'abra', castka: 260000 })
    fakty.push({ period: p, cil: { kind: 'cinnost', id: 'C_SKOLA' }, kategorieId: 'K_NAJEM', typ: 'naklad', zdroj: 'abra', castka: 40000 })
    fakty.push({ period: p, cil: { kind: 'cinnost', id: 'C_D' }, kategorieId: 'K_MZDY', typ: 'naklad', zdroj: 'abra', castka: 99999 })  // jiná činnost — nepočítá se do Školy
  }
  const plan = [
    { period: '2026-07', cinnostId: 'C_PO', kategorieId: 'K_MZ_AP', castka: 25000 },
    { period: '2026-08', cinnostId: 'C_PO', kategorieId: 'K_MZ_AP', castka: 25000 },
    { period: '2026-07', cinnostId: 'C_SKOLA', kategorieId: 'K_MZDY', castka: 260000 },
    { period: '2026-07', cinnostId: 'C_SKOLA', kategorieId: 'K_NAJEM', castka: 40000 },
    { period: '2026-08', cinnostId: 'C_SKOLA', kategorieId: 'K_MZDY', castka: 300000 },
    { period: '2026-08', cinnostId: 'C_D', kategorieId: 'K_MZDY', castka: 50000 },        // jiná činnost
  ]
  const [rAp, rSk] = spocitatCerpani({ baliky: [ap, sk], uzavreno, zbyva, fakty, plan, narokOdhad: new Map() })
  // AP: dotace 12 × 20 000 (výhled průměrem, odhad); čerpáno 10 × 15 000, plánované budoucí 50 000 → zbývá dočerpat 40 000
  assert.deepEqual([rAp.dotaceRok, rAp.dotaceVyhledOdhad, rAp.cerpaniVyhled, rAp.budouciBezPlanu, rAp.cerpaniRok, rAp.zbyva, rAp.stav],
    [240000, true, 50000, 0, 200000, 40000, 'vratka'])
  // Škola: plánované budoucí = 300 000 + 300 000 (bez Družiny), čerpání za rok 3,6 mil. → vyčerpáno
  assert.deepEqual([rSk.cerpaniVyhled, rSk.dotaceRok, rSk.cerpaniRok, rSk.stav, rSk.podil], [600000, 3600000, 3600000, 'ok', 100])
  // Bez rozpočtu nákladů na zbývající měsíce → nelze vyhodnotit (žádný průměr)
  const [rBez] = spocitatCerpani({ baliky: [sk], uzavreno, zbyva, fakty, plan: [], narokOdhad: new Map() })
  assert.deepEqual([rBez.cerpaniVyhled, rBez.budouciBezPlanu, rBez.stav], [0, 2, 'neznamo'])
  assert.equal(stavCerpani(-50000, 1000000), 'precerpano')
  assert.equal(stavCerpani(15000, 1000000), 'ok')          // v toleranci 2 %
  assert.equal(stavCerpani(900, 10000), 'ok')              // minimum 1 000 Kč
})

t('čerpání dotací bez ABRA: uzavřené měsíce z rozpočtu, chybí-li i ten → nelze vyhodnotit', () => {
  const ap: Balik = { id: 'B_AP', kod: 'po_ap', nazev: 'AP', cinnostId: null, polozkaIds: ['P_AP'], kategorieIds: ['K_MZ_AP'],
    dotaceCile: [{ cinnostId: 'C_PO', kategorieId: 'K_DOT_AP' }] }
  const uzavreno = ['2026-09', '2026-10']
  const zbyva = ['2026-11', '2026-12']
  const fakty: MuFakt[] = uzavreno.map((p) => ({ period: p, cil: { kind: 'cinnost', id: 'C_PO' }, kategorieId: 'K_DOT_AP', typ: 'prijem', zdroj: 'dotace', castka: 20000, ref: { kind: 'vf', id: `${p}|P_AP` } }))
  const planVsech = ['2026-09', '2026-10', '2026-11', '2026-12'].map((p) => ({ period: p, cinnostId: 'C_PO', kategorieId: 'K_MZ_AP', castka: 20000 }))
  const [r] = spocitatCerpani({ baliky: [ap], uzavreno, zbyva, fakty, plan: planVsech.slice(2), narokOdhad: new Map(),
    abraOk: false, planUzavreno: planVsech.slice(0, 2) })
  assert.deepEqual([r.cerpaniSkut, r.cerpaniSkutZRozpoctu, r.chybiMesicu, r.cerpaniRok, r.stav], [40000, true, 0, 80000, 'ok'])
  const [r2] = spocitatCerpani({ baliky: [ap], uzavreno, zbyva, fakty, plan: planVsech.slice(2), narokOdhad: new Map(),
    abraOk: false, planUzavreno: planVsech.slice(1, 2) })   // září bez rozpočtu
  assert.deepEqual([r2.chybiMesicu, r2.stav], [1, 'neznamo'])
})

t('F3: rozdělení řádku ABRA — části na akci, zbytek podle pravidel, storno, překročení', () => {
  const pr = [P({ id: 'p', ucet_prefix: '512', cil_cinnost_id: 'C_SKOLA', kategorie_id: 'K_JIZDNE' })]
  const radky = [
    R({ flexi_id: 1, md_ucet: '512100', dal_ucet: '321000', castka: 10000 }),
    R({ flexi_id: 2, md_ucet: '321000', dal_ucet: '512100', castka: 1000 }),   // storno
    R({ flexi_id: 3, md_ucet: '512100', dal_ucet: '321000', castka: 500 }),
  ]
  const split = (flexi_id: number, castka: number) => ({ id: `s${flexi_id}`, flexi_id, ucet: '512100', cil_cinnost_id: null, cil_akce_id: 'A_EXP', kategorie_id: 'K_JIZDNE', castka, poznamka: null })
  const splits = new Map([[1, [split(1, 3000)]], [2, [split(2, 1000)]], [3, [split(3, 800)]]])
  const { fakty, stat } = faktyAbra(radky, new Set(['2026-09']), pr, new Map(), [], kody, splits)
  const b = bilanceBy(fakty, (f) => cilKey(f.cil))
  assert.equal(b.get('a:A_EXP')?.naklady, 3000 - 1000 + 800)     // část faktury, storno celé na akci, překročená část
  assert.equal(b.get('c:C_SKOLA')?.naklady, 7000)                 // zbytky: 7 000 + 0 + 0 (překročení → zbytek 0)
  assert.equal(stat.splitPrekroceno, 1)
  assert.equal(fakty.filter((f) => f.rozdeleno).length, 3)
})

t('F3: personální náklady akce — náklad akce, odečet z mezd Školy, bilance beze změny', () => {
  const k = { ...kody, kategorie: new Map([...kody.kategorie, ['personalni_akce', 'K_PERS']]) }
  const f = faktyPreuctovani([
    { id: 'A1', datum_od: '2026-09-20', personalni_naklady: 12000, personalni_period: null },
    { id: 'A2', datum_od: '2026-09-01', personalni_naklady: 5000, personalni_period: '2026-12' },   // mimo období
    { id: 'A3', datum_od: '2026-09-01', personalni_naklady: null, personalni_period: null },
  ], new Set(['2026-09']), k)
  assert.deepEqual(f.map((x) => [cilKey(x.cil), x.kategorieId, x.castka]), [['a:A1', 'K_PERS', 12000], ['c:C_SKOLA', 'K_MZDY', -12000]])
  assert.equal(celkem(f).naklady, 0)
})

t('Kontrola: zůstatek 221/211 — otevření z deníku, ruční počátek, chybějící', () => {
  const K = (o: Partial<KontrolaRadek> & { flexi_id: number }): KontrolaRadek => ({
    dat_ucto: '2026-01-15', md_ucet: null, dal_ucet: null, castka: 0, doklad: null, id_dokl: null, evidence_path: null,
    popis: null, firma: null, smazano: false, zuctovano: true, ...o,
  })
  const pohyby = [
    K({ flexi_id: 1, md_ucet: '221100', dal_ucet: '311000', castka: 50000 }),          // příjem školného
    K({ flexi_id: 2, md_ucet: '321000', dal_ucet: '221100', castka: 20000 }),          // úhrada faktury
    K({ flexi_id: 3, md_ucet: '211100', dal_ucet: '221100', castka: 5000 }),           // výběr do pokladny
    K({ flexi_id: 4, md_ucet: '501100', dal_ucet: '211100', castka: 7000 }),           // nákup z pokladny
    K({ flexi_id: 5, md_ucet: '221100', dal_ucet: '311000', castka: 999, zuctovano: false }),
  ]
  assert.deepEqual(zustatekUctu(pohyby, '221', 2026, '2026-12-31', null), { zustatek: 25000, pocatekZdroj: 'chybi' })
  assert.deepEqual(zustatekUctu(pohyby, '221', 2026, '2026-12-31', 400000), { zustatek: 425000, pocatekZdroj: 'rucne' })
  const sOtevrenim = [...pohyby, K({ flexi_id: 6, dat_ucto: '2026-01-01', md_ucet: '221100', dal_ucet: '701000', castka: 300000 })]
  assert.deepEqual(zustatekUctu(sOtevrenim, '221', 2026, '2026-12-31', 400000), { zustatek: 325000, pocatekZdroj: 'ucetnictvi' })
  assert.equal(zustatekUctu(pohyby, '211', 2026, '2026-12-31', 0).zustatek, -2000)     // záporná pokladna
  assert.equal(zustatekUctu(pohyby, '221', 2026, '2026-01-10', 0).zustatek, 0)          // k datu před pohyby
})

t('Kontrola: párování FIO ↔ ABRA — přesná částka, ±3 dny, nejbližší datum, každý jednou', () => {
  const K = (flexi_id: number, datum: string, md: string, dal: string, castka: number, id_dokl: number): KontrolaRadek => ({
    flexi_id, dat_ucto: datum, md_ucet: md, dal_ucet: dal, castka, doklad: `B${id_dokl}`, id_dokl, evidence_path: 'banka',
    popis: null, firma: null, smazano: false, zuctovano: true,
  })
  const docs = bankovniDoklady([
    K(1, '2026-09-10', '221100', '311000', 4400, 1),
    K(2, '2026-09-11', '221100', '311000', 4400, 2),
    K(3, '2026-09-15', '321000', '221100', 1500, 3), K(4, '2026-09-15', '343000', '221100', 300, 3),   // jeden doklad, dva řádky
    K(5, '2026-09-20', '221100', '602100', 999, 4),
  ])
  assert.deepEqual(docs.map((d) => [d.key, d.castka]).sort(), [['banka|1', 4400], ['banka|2', 4400], ['banka|3', -1800], ['banka|4', 999]])
  const fio = [
    { id: 'f1', datum: '2026-09-11', castka: 4400, protistrana: null, poznamka: null },
    { id: 'f2', datum: '2026-09-12', castka: 4400, protistrana: null, poznamka: null },
    { id: 'f3', datum: '2026-09-14', castka: -1800, protistrana: null, poznamka: null },
    { id: 'f4', datum: '2026-09-30', castka: -250, protistrana: null, poznamka: null },
  ]
  const r = sparovat(fio, docs, 3)
  assert.equal(r.pary.length, 3)
  assert.deepEqual(r.jenFio.map((f) => f.id), ['f4'])
  assert.deepEqual(r.jenAbra.map((d) => d.key), ['banka|4'])

  // Dřívější pohyb nesmí sebrat doklad, který přesně sedí na pozdější (3 000 Kč, květen 2026).
  const d3 = bankovniDoklady([
    K(11, '2026-05-22', '221100', '602200', 3000, 11),
    K(12, '2026-05-27', '221100', '602200', 3000, 12),
  ])
  const f3 = [
    { id: 'pelc', datum: '2026-05-25', castka: 3000, protistrana: null, poznamka: null },
    { id: 'tarant', datum: '2026-05-27', castka: 3000, protistrana: null, poznamka: null },
  ]
  const r3 = sparovat(f3, d3, 3)
  assert.deepEqual(r3.pary.map((p) => [p.fio.id, p.abra.key]).sort(), [['pelc', 'banka|11'], ['tarant', 'banka|12']])

  // Druhé kolo: zbylý pohyb FIO proti nezaúčtovaným dokladům banka (klíč banka|id, datum vystavení).
  const nez = [
    nezauctovanyDoklad({ id: 77, kod: 'BV26500', datum: '2026-09-30', castka: -250, popis: null, firma: null }),
    nezauctovanyDoklad({ id: 78, kod: 'BV26501', datum: '2026-09-30', castka: 324, popis: null, firma: null }),
  ]
  const r2 = sparovat(r.jenFio, nez, 3)
  assert.deepEqual(r2.pary.map((p) => [p.fio.id, p.abra.key, p.abra.doklad]), [['f4', 'banka|77', 'BV26500']])
  assert.equal(r2.jenFio.length, 0)
})

t('Doklady: výpis všech položek vč. ignorovaných, nezaúčtovaných a rozdělených', () => {
  const pr = [P({ id: 'p', ucet_prefix: '5', cil_cinnost_id: 'C_SKOLA', kategorie_id: 'K_ON' })]
  const radky = [
    R({ flexi_id: 1, md_ucet: '518100', dal_ucet: '321000', castka: 1000 }),
    R({ flexi_id: 2, md_ucet: '518100', dal_ucet: '321000', castka: 200 }),
    R({ flexi_id: 3, md_ucet: '518100', dal_ucet: '321000', castka: 50, zuctovano: false }),
    R({ flexi_id: 4, md_ucet: '311000', dal_ucet: '602100', castka: 4400 }),
  ]
  const ov = new Map([[2, { flexi_id: 2, cil_cinnost_id: null, cil_akce_id: null, kategorie_id: null, vyloucit: true, period: null, poznamka: 'duplicita' }]])
  const splits = new Map([[1, [{ id: 's', flexi_id: 1, ucet: '518100', cil_cinnost_id: null, cil_akce_id: 'A1', kategorie_id: 'K_ON', castka: 300, poznamka: null }]]])
  const v = polozkyAbraVypis(radky, new Set(['2026-09']), pr, ov, [], kody, splits)
  assert.equal(v.length, 4)
  assert.deepEqual(v.map((p) => [p.flexi_id, p.ignorovano, p.ignorovanoRucne, p.nezauctovano, p.rozdeleno, p.typ]), [
    [1, false, false, false, 300, 'naklad'], [2, true, true, false, 0, 'naklad'], [3, false, false, true, 0, 'naklad'], [4, false, false, false, 0, 'prijem'],
  ])
  // faktyAbra ignorovaný doklad nezapočítá
  assert.equal(faktyAbra(radky, new Set(['2026-09']), pr, ov, [], kody).fakty.some((f) => f.ref?.id === '2'), false)
})

t('Darové fondy jako příjem; nezařazené výnosy třídy 6 jen kontrolně', () => {
  const k = { ...kody, kategorie: new Map([...kody.kategorie, ['dary', 'K_DARY']]) }
  const pr = [P({ id: 'p', ucet_prefix: '5', cil_cinnost_id: 'C_SKOLA', kategorie_id: 'K_ON' })]
  const radky = [
    R({ flexi_id: 1, md_ucet: '378100', dal_ucet: '911400', castka: 450000, zakazka: 'NF ZEMĚKVĚT' }),   // dar na grant
    R({ flexi_id: 2, md_ucet: '221100', dal_ucet: '911500', castka: 5000 }),                              // neúčelový dar
    R({ flexi_id: 3, md_ucet: '931100', dal_ucet: '911200', castka: 34766 }),                             // převod zisku — není dar
    R({ flexi_id: 4, md_ucet: '311000', dal_ucet: '602100', castka: 4400 }),                              // školné v ABRA — jen kontrolně
    R({ flexi_id: 5, md_ucet: '501500', dal_ucet: '321000', castka: 1000, zakazka: 'NF ZEMĚKVĚT' }),
  ]
  assert.deepEqual(rozlozRadek(radky[0], ['911400']).map((p) => [p.ucet, p.typ, p.castka, p.dar]), [['911400', 'prijem', 450000, true]])
  const { fakty, stat } = faktyAbra(radky, new Set(['2026-09']), pr, new Map(), [{ id: 'G_NF', abra_zakazka: 'NF ZEMĚKVĚT' }], k, new Map(), ['911400', '911500'])
  const b = bilanceBy(fakty, (f) => cilKey(f.cil))
  assert.deepEqual([b.get('a:G_NF')?.prijmy, b.get('a:G_NF')?.naklady], [450000, 1000])   // grant: dar i náklady ze zakázky
  assert.equal(b.get('c:C_SKOLA')?.prijmy, 5000)                                           // neúčelový dar → Škola
  assert.equal(fakty.find((f) => f.ref?.id === '1')?.kategorieId, 'K_DARY')
  assert.equal(fakty.some((f) => f.ref?.id === '3' || f.ref?.id === '4'), false)
  assert.equal(stat.vynosyKontrolni, 1)
  assert.equal(celkem(fakty).prijmy, 455000)
})

t('Dar na výnosu 682100: zakázka grantu přebije pravidlo se střediskem; darový účet třídy 6 bez dvojího započtení', () => {
  // Realita 2026-10-29: OP26017 378100/682100 se střediskem C; pravidlo 682100 + středisko C → Obědy (výnosy jen kontrolně).
  const k = { ...kody, kategorie: new Map([...kody.kategorie, ['dary', 'K_DARY']]) }
  const pr = [P({ id: 'p682', ucet_prefix: '682100', stredisko: 'C', cil_cinnost_id: 'C_OB', kategorie_id: 'K_OP' })]
  const akce = [{ id: 'G_NF', abra_zakazka: 'NF ZEMĚKVĚT' }]
  const zPlateb = cinnostiZPlateb(k)
  const radky = [
    R({ flexi_id: 1, md_ucet: '378100', dal_ucet: '682100', castka: 450000, zakazka: 'NF ZEMĚKVĚT', stredisko: 'C' }),
    R({ flexi_id: 2, md_ucet: '221100', dal_ucet: '682100', castka: 1078, stredisko: 'C' }),   // drobný dar bez zakázky
  ]
  // Bez 682100 mezi darovými účty: grant dostane výnos (akce bez SS), drobný dar jde podle pravidla do Obědů → jen kontrolně.
  const a = faktyAbra(radky, new Set(['2026-09']), pr, new Map(), akce, k, new Map(), ['911400'], new Set(), zPlateb)
  assert.equal(bilanceBy(a.fakty, (f) => cilKey(f.cil)).get('a:G_NF')?.prijmy, 450000)
  assert.deepEqual(a.kontrolni.map((f) => f.ref?.id), ['2'])
  // S 682100 jako darovým účtem: obojí je dar, počítá se jednou, nic není kontrolní.
  assert.deepEqual(rozlozRadek(radky[0], ['682100']).map((p) => [p.ucet, p.castka, p.dar]), [['682100', 450000, true]])
  const d = faktyAbra(radky, new Set(['2026-09']), pr, new Map(), akce, k, new Map(), ['911400', '682100'], new Set(), zPlateb)
  const b = bilanceBy(d.fakty, (f) => cilKey(f.cil))
  assert.deepEqual([b.get('a:G_NF')?.prijmy, b.get('c:C_OB')?.prijmy, d.kontrolni.length, celkem(d.fakty).prijmy], [450000, 1078, 0, 451078])
})

t('Akce s SS: výnosy z ABRA jen kontrolně (příjmy z Plateb), náklady, dary a akce bez SS se počítají', () => {
  const k = { ...kody, kategorie: new Map([...kody.kategorie, ['dary', 'K_DARY']]) }
  const ov = new Map([
    [1, { flexi_id: 1, cil_cinnost_id: null, cil_akce_id: 'A_SS', kategorie_id: 'K_OP', vyloucit: false, period: null, poznamka: 'platby rodičů' }],
    [3, { flexi_id: 3, cil_cinnost_id: null, cil_akce_id: 'A_BEZ', kategorie_id: 'K_OP', vyloucit: false, period: null, poznamka: 'vstupné' }],
  ])
  const splits = new Map([[2, [{ id: 's', flexi_id: 2, ucet: '602100', cil_cinnost_id: null, cil_akce_id: 'A_SS', kategorie_id: 'K_OP', castka: 300, poznamka: null }]]])
  const radky = [
    R({ flexi_id: 1, md_ucet: '221100', dal_ucet: '602100', castka: 4000 }),                     // výnos přeřazený na akci s SS
    R({ flexi_id: 2, md_ucet: '221100', dal_ucet: '602100', castka: 1000 }),                     // část výnosu (split) na akci s SS
    R({ flexi_id: 3, md_ucet: '221100', dal_ucet: '602100', castka: 700 }),                      // výnos akce bez SS — počítá se
    R({ flexi_id: 4, md_ucet: '501500', dal_ucet: '321000', castka: 2500, zakazka: 'EXP' }),     // náklad akce s SS
    R({ flexi_id: 5, md_ucet: '378100', dal_ucet: '911400', castka: 900, zakazka: 'EXP' }),      // dar na akci s SS — počítá se
  ]
  const akce = [{ id: 'A_SS', abra_zakazka: 'EXP' }, { id: 'A_BEZ', abra_zakazka: null }]
  const { fakty, kontrolni } = faktyAbra(radky, new Set(['2026-09']), [], ov, akce, k, splits, ['911400'], new Set(['A_SS']))
  const b = bilanceBy(fakty, (f) => cilKey(f.cil))
  assert.deepEqual([b.get('a:A_SS')?.prijmy, b.get('a:A_SS')?.naklady], [900, 2500])
  assert.equal(b.get('a:A_BEZ')?.prijmy, 700)
  assert.deepEqual(kontrolni.map((f) => [f.ref?.id, f.castka]).sort(), [['1', 4000], ['2', 300]])
  const v = polozkyAbraVypis(radky, new Set(['2026-09']), [], ov, akce, k, splits, ['911400'], new Set(['A_SS']))
  // 1 = výnos akce s SS; 2 = nezařazený zbytek po rozdělení (D2); 3 = akce bez SS se počítá
  assert.deepEqual(v.filter((p) => p.kontrolni).map((p) => p.flexi_id), [1, 2])
})

t('Činnosti s příjmy z Plateb: výnosy ABRA Družiny, Obědů a školného jen kontrolně, ostatní výnosy Školy se počítají', () => {
  const k = { ...kody, kategorie: new Map([...kody.kategorie, ['dary', 'K_DARY']]) }
  const pr = [
    P({ id: 'p1', ucet_prefix: '6024', cil_cinnost_id: 'C_D', kategorie_id: 'K_OP' }),
    P({ id: 'p2', ucet_prefix: '6023', cil_cinnost_id: 'C_OB', kategorie_id: 'K_OP' }),
    P({ id: 'p3', ucet_prefix: '6', cil_cinnost_id: 'C_SKOLA', kategorie_id: 'K_OP' }),
    P({ id: 'p4', ucet_prefix: '5', cil_cinnost_id: 'C_D', kategorie_id: 'K_ON' }),
  ]
  const radky = [
    R({ flexi_id: 1, md_ucet: '221100', dal_ucet: '602400', castka: 1000 }),   // úplata ŠD — kontrolně
    R({ flexi_id: 2, md_ucet: '221100', dal_ucet: '602300', castka: 130 }),    // obědy — kontrolně
    R({ flexi_id: 3, md_ucet: '315100', dal_ucet: '602100', castka: 56000 }),  // školné — kontrolně
    R({ flexi_id: 4, md_ucet: '221100', dal_ucet: '682100', castka: 5000 }),   // dar Škole (výnos) — počítá se
    R({ flexi_id: 5, md_ucet: '501100', dal_ucet: '321000', castka: 800 }),    // náklad družiny — počítá se
    R({ flexi_id: 6, md_ucet: '378100', dal_ucet: '911400', castka: 900 }),    // dar z fondu — počítá se
  ]
  const zp = cinnostiZPlateb(k)
  const { fakty, kontrolni } = faktyAbra(radky, new Set(['2026-09']), pr, new Map(), [], k, new Map(), ['911400'], new Set(), zp)
  const b = bilanceBy(fakty, (f) => cilKey(f.cil))
  assert.deepEqual([b.get('c:C_D')?.prijmy, b.get('c:C_D')?.naklady], [0, 800])
  assert.equal(b.get('c:C_OB'), undefined)
  assert.equal(b.get('c:C_SKOLA')?.prijmy, 5900)
  assert.deepEqual(kontrolni.map((f) => f.ref?.id).sort(), ['1', '2', '3'])
  const v = polozkyAbraVypis(radky, new Set(['2026-09']), pr, new Map(), [], k, new Map(), ['911400'], new Set(), zp)
  assert.deepEqual(v.filter((p) => p.kontrolni).map((p) => p.flexi_id), [1, 2, 3])
})

t('Kontrola: přiznaná dotace KÚ z účtu 346 — předpisy, vratka, bez zúčtování do výnosů', () => {
  const K = (flexi_id: number, datum: string, md: string, dal: string, castka: number, zakazka: string | null) => ({
    flexi_id, dat_ucto: datum, md_ucet: md, dal_ucet: dal, castka, doklad: null, id_dokl: null, evidence_path: null,
    popis: null, firma: null, smazano: false, zuctovano: true, zakazka,
  })
  const r = prijataDotace([
    K(1, '2026-01-31', '378100', '346100', 87216, 'PROVOZ'), K(2, '2026-01-31', '378100', '346100', 18744, 'ASISTENT'),
    K(3, '2026-04-01', '378100', '346100', -1862, 'JÍDELNA'),        // záporný doplatek
    K(4, '2026-05-10', '346100', '221100', 1000, 'PROVOZ'),          // vratka
    K(5, '2026-12-31', '346100', '691100', 500000, 'PROVOZ'),        // zúčtování do výnosů — nepočítat
    K(6, '2026-01-30', '221100', '378100', 111738, null),            // platba proti 378 — není na 346
  ], '346')
  assert.deepEqual([...r.poMesicich.entries()].sort(), [['2026-01', 105960], ['2026-04', -1862], ['2026-05', -1000]])
  assert.equal(r.poZakazkach.get('PROVOZ'), 86216)
})

t('plán: návrh dotací z nároku VF — skutečnost do aktuálního měsíce, dál poslední nárok', () => {
  const mesice = oknoMesice('2026/2027')!
  const narok = [
    { period: '2026-09', polozkaId: 'P_ZS', narok: 300000 }, { period: '2026-10', polozkaId: 'P_ZS', narok: 310000 },
    { period: '2026-09', polozkaId: 'P_AP', narok: 20000 },  { period: '2026-10', polozkaId: 'P_AP', narok: 20000 },
    { period: '2026-10', polozkaId: 'P_SPEC', narok: null },  // chybí parametry → přeskočit
    { period: '2026-10', polozkaId: 'P_ZS2', narok: 5000 },   // druhá položka do stejné činnosti/kategorie → sečíst
  ]
  const mapa = new Map([
    ['P_ZS', { cinnostId: 'C_SKOLA', kategorieId: 'K_DOT' }], ['P_ZS2', { cinnostId: 'C_SKOLA', kategorieId: 'K_DOT' }],
    ['P_AP', { cinnostId: 'C_PO', kategorieId: 'K_DOT_AP' }], ['P_SPEC', { cinnostId: 'C_PO', kategorieId: 'K_DOT_SPEC' }],
  ])
  const b = navrhDotaci(mesice, '2026-10', narok, mapa)
  const v = (p: string, k: string) => b.find((x) => x.period === p && x.kategorieId === k)?.castka
  assert.equal(v('2026-09', 'K_DOT'), 300000)
  assert.equal(v('2026-10', 'K_DOT'), 315000)
  assert.equal(v('2027-03', 'K_DOT'), 315000)          // budoucnost = nárok aktuálního měsíce
  assert.equal(v('2027-08', 'K_DOT_AP'), 20000)
  assert.equal(b.some((x) => x.kategorieId === 'K_DOT_SPEC'), false)
  assert.equal(b.length, 24)                           // 12 měsíců × (Škola, AP)
})

t('zakázka se zástupným znakem: všechny školní roky, přesná zakázka má přednost', () => {
  const r = (zakazka: string | null) => ({ zakazka, stredisko: null, cinnost_abra: null })
  const pr = [
    P({ id: 'w', ucet_prefix: '52', zakazka: '33 155 ASISTENT*', cil_cinnost_id: 'C_PO', kategorie_id: 'K_MZDY_AP' }),
    P({ id: 'e', ucet_prefix: '52', zakazka: '33 155 ASISTENT 9/25-8/26', cil_cinnost_id: 'C_X', kategorie_id: 'K_MZDY' }),
  ]
  assert.equal(vyberPravidlo(pr.slice(0, 1), '521100', r('33 155 ASISTENT 9/26-8/27'))?.pravidlo.id, 'w')
  assert.equal(vyberPravidlo(pr.slice(0, 1), '521100', r('33 155 DOTACE PROVOZ 9/25-8/26')), null)
  assert.equal(vyberPravidlo(pr.slice(0, 1), '521100', r(null)), null)
  const v = vyberPravidlo(pr, '521100', r('33 155 ASISTENT 9/25-8/26'))
  assert.equal(v?.pravidlo.id, 'e')
  assert.equal(v?.konflikt, false)
})

t('kategorie PO patří jen činnosti PO (výnos i náklad pryč ze Školy)', () => {
  const k: MuKody = {
    kategorie: new Map([['dotace_po', 'K_DP'], ['dotace_po_ap', 'K_DP_AP'], ['mzdy_po_spec', 'K_MP_SPEC'], ['mzdy', 'K_MZDY'], ['dotace', 'K_DOT']]),
    cinnost: new Map([['skola', 'C_SKOLA'], ['po', 'C_PO']]),
  }
  const f = (cil: MuFakt['cil'], kategorieId: string | null) => ({ cil, kategorieId })
  const out = presunPo([
    f({ kind: 'cinnost', id: 'C_SKOLA' }, 'K_DP_AP'),       // dotace PO ve Škole → PO
    f({ kind: 'cinnost', id: 'C_SKOLA' }, 'K_MP_SPEC'),     // mzdy PO ve Škole → PO
    f({ kind: 'cinnost', id: 'C_SKOLA' }, 'K_MZDY'),        // obecné mzdy zůstávají
    f({ kind: 'akce', id: 'A1' }, 'K_DP'),                  // akce zůstává
    f({ kind: 'cinnost', id: 'C_PO' }, 'K_DP'),
  ], k)
  assert.deepEqual(out.map((x) => cilKey(x.cil)), ['c:C_PO', 'c:C_PO', 'c:C_SKOLA', 'a:A1', 'c:C_PO'])
  assert.deepEqual([...poKategorie(k)].sort(), ['K_DP', 'K_DP_AP', 'K_MP_SPEC'])
})

console.log(`\n${n} testů OK`)
