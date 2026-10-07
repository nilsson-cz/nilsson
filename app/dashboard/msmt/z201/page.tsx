/**
 * app/dashboard/msmt/z201/page.tsx
 * Server Component — director-only: výkaz Z 2-01 o školní družině k 31. 10.
 * spočítaný z dat IS (lib/vykaz-z201.ts) v rozložení formuláře sberdat.uiv.cz,
 * aby šel řádek po řádku přepsat. Každé nenulové číslo jde rozkliknout na
 * seznam účastníků / pracovníků. Nahoře upozornění na chybějící data a
 * kontrolní vazby z metodického pokynu.
 *
 * Hodnoty = buňky (bunkyZ201): živý výpočet + ruční přepisy, nebo zmrazený
 * odevzdaný stav (vykaz_z201, migrace 151). Kontrolní vazby se počítají nad
 * zobrazenými hodnotami.
 *
 * PRD: PRD-vykaz-z201-druzina-2026-10-06 (fáze F2 + F3). Údaje o zdravotním
 * postižení = zvláštní kategorie osobních údajů → stránka jen pro ředitele.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeSchoolYear } from '@/lib/school-year'
import { msmtEnv } from '@/lib/msmt-env'
import { nactiVstupZ201 } from '@/lib/vykaz-z201-data'
import {
  aplikujPrepisy, bunkyZ201, kontrolyZ201, radkyXXI, vypocetZ201,
  type Bunky, type Prepis, type RadekIX,
} from '@/lib/vykaz-z201'
import { nazevStatu } from '@/lib/staty-rast'
import Cislo from './_components/Cislo'
import TiskButton from './_components/TiskButton'
import ZmrazeniPanel from './_components/ZmrazeniPanel'

export const metadata = { title: 'Výkaz Z 2-01 — školní družina — IS Nilsson' }
export const dynamic = 'force-dynamic'

const th = 'px-3 py-1.5 text-xs font-medium text-gray-500 text-right whitespace-nowrap'
const thL = 'px-3 py-1.5 text-xs font-medium text-gray-500 text-left'
const td = 'px-3 py-1 text-sm text-right'
const tdL = 'px-3 py-1 text-sm text-gray-800'
const tdR = 'px-3 py-1 font-mono text-xs text-gray-400'

function Oddil({ nazev, popis, children }: { nazev: string; popis?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white break-inside-avoid">
      <div className="border-b border-gray-100 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-800">{nazev}</h2>
        {popis && <p className="text-xs text-gray-400">{popis}</p>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

const RADKY_IX_NAZVY: { r: RadekIX; nazev: string; odsazeni?: boolean }[] = [
  { r: '0901', nazev: 'S mentálním postižením' },
  { r: '0901a', nazev: 'z toho se středně těžkým', odsazeni: true },
  { r: '0902', nazev: 's těžkým', odsazeni: true },
  { r: '0903', nazev: 's hlubokým', odsazeni: true },
  { r: '0904', nazev: 'Se sluchovým postižením' },
  { r: '0905', nazev: 'z toho s těžkým', odsazeni: true },
  { r: '0906', nazev: 'Se zrakovým postižením' },
  { r: '0907', nazev: 'z toho s těžkým', odsazeni: true },
  { r: '0908', nazev: 'Se závažnými vadami řeči' },
  { r: '0908a', nazev: 'z toho s těžkými', odsazeni: true },
  { r: '0909', nazev: 'S tělesným postižením' },
  { r: '0909a', nazev: 'z toho s těžkým', odsazeni: true },
  { r: '0910', nazev: 'S více vadami' },
  { r: '0911', nazev: 'z toho hluchoslepí', odsazeni: true },
  { r: '0912a', nazev: 'Se závažnými vývoj. poruchami učení' },
  { r: '0914a', nazev: 'Se závažnými vývoj. poruchami chování' },
  { r: '0915', nazev: 'S poruchami autistického spektra' },
  { r: '0918', nazev: 'Celkem' },
]

const RADKY_V: [string, string, number][] = [
  ['0501', 'Účastníci se SVP celkem', 0],
  ['0502', 'se zdrav. postižením (§ 16 odst. 9)', 1],
  ['0503', 's jiným zdrav. znevýhodněním', 1],
  ['0511', 'se sociálním znevýhodněním celkem (vč. ohrožených)', 1],
  ['0512', 'ohrožení soc. znevýhodněním', 2],
  ['0513', 's významnou potřebou podpory', 2],
  ['0514', 'se zásadní potřebou podpory', 2],
  ['0505', 'kategorie K', 2],
  ['0506', 'kategorie Z', 2],
  ['0507', 'kategorie V', 2],
  ['0508', 'Nadaní účastníci', 0],
  ['0509', 'z toho mimořádně nadaní', 1],
  ['0510', 'Účastníci s přiznaným PO s kódem NFN', 0],
]

const RADKY_XIV: [string, string, boolean][] = [
  ['1401', 'Vychovatelé', false], ['1402', 'interní', true], ['1403', 'externí', true],
  ['1404', 'Ostatní pedag. pracovníci', false], ['1404a', 'z toho asistenti pedagoga', true],
  ['1405', 'z ř. 1404 interní', true], ['1406', 'z ř. 1404 externí', true],
]

export default async function Z201Page({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  if ((me as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Výkaz Z 2-01</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const aktualni = Number(computeSchoolYear(new Date()).slice(0, 4))
  const zadany = Number((await searchParams).rok)
  const rok = Number.isInteger(zadany) && zadany >= 2026 && zadany <= aktualni ? zadany : aktualni

  let vstup
  try {
    vstup = await nactiVstupZ201(supabase, rok)
  } catch (e) {
    return <div className="p-6 text-red-600">Chyba při načítání dat: {(e as Error).message}</div>
  }
  const r = vypocetZ201(vstup)
  const env = msmtEnv()

  // --- Buňky: živý výpočet + přepisy, nebo zmrazený stav ---
  const { data: zaznam } = await supabase.from('vykaz_z201')
    .select('prepisy, hodnoty, zmrazeno_at, zmrazeno_by').eq('rok', rok).maybeSingle()
  const prepisy = ((zaznam?.prepisy ?? {}) as unknown) as Record<string, Prepis>
  const zive = bunkyZ201(r)
  const zmrazeno = !!zaznam?.zmrazeno_at
  const b: Bunky = zmrazeno ? ((zaznam?.hodnoty ?? {}) as unknown as Bunky) : aplikujPrepisy(zive, prepisy)
  const kontroly = kontrolyZ201(b)
  const neprosle = kontroly.filter((k) => !k.ok)
  const rozdily = zmrazeno
    ? [...new Set([...Object.keys(b), ...Object.keys(zive)])].filter((k) => (b[k] ?? 0) !== (zive[k] ?? 0)).length
    : 0
  let zmrazilJmeno: string | null = null
  if (zaznam?.zmrazeno_by) {
    const { data: s } = await supabase.from('staff').select('first_name, last_name').eq('id', zaznam.zmrazeno_by).maybeSingle()
    zmrazilJmeno = s ? `${s.first_name} ${s.last_name}` : null
  }

  // --- Seznamy za buňkami (jen u živého výpočtu) ---
  const jmenoZaka = new Map(vstup.zaci.map((z) => [z.id, z.trida ? `${z.jmeno} (${z.trida})` : z.jmeno]))
  const jmena = (ids: string[]) => ids.map((id) => jmenoZaka.get(id) ?? id)
  const divkyIds = (ids: string[]) => ids.filter((id) => vstup.zaci.find((z) => z.id === id)?.zena)
  const seznamy: Record<string, string[]> = {}
  const pridejSeznam = (radek: string, ids: string[], sl: [string, string]) => {
    seznamy[`${radek}:${sl[0]}`] = jmena(ids)
    seznamy[`${radek}:${sl[1]}`] = jmena(divkyIds(ids))
  }
  pridejSeznam('0102', r.I.r0102.ids, ['4', '5'])
  pridejSeznam('0103', r.I.r0103.ids, ['4', '5'])
  pridejSeznam('0105', r.I.r0105.ids, ['4', '5'])
  for (const [k, v] of Object.entries(r.IV)) pridejSeznam(k, v.ids, ['4', '5'])
  for (const [k, v] of Object.entries(r.V)) pridejSeznam(k, v.ids, ['2', '3'])
  for (const [k, v] of Object.entries(r.IX)) {
    pridejSeznam(k, v.ids, ['2', '2a'])
    seznamy[`${k}:2b`] = jmena(v.poSdIds)
  }
  for (const x of r.XXI) pridejSeznam(`XXI:${x.stpr}:${x.zdravotniPostizeni ? 'ano' : 'ne'}`, x.celkem.ids, ['2', '4'])
  if (vstup.uvazky.length) {
    const { data: st } = await supabase.from('staff').select('id, first_name, last_name')
      .in('id', [...new Set(vstup.uvazky.map((u) => u.staff_id))])
    const jmenoPracovnika = new Map((st ?? []).map((s) => [s.id, `${s.last_name} ${s.first_name}`]))
    const platne = vstup.uvazky.filter((u) => !u.nepritomen)
    const popis = (u: typeof platne[number]) =>
      `${jmenoPracovnika.get(u.staff_id) ?? '?'} — ${u.interni ? `úvazek ${String(u.uvazek).replace('.', ',')}` : `${String(u.hodiny_rijen).replace('.', ',')} h v říjnu`}`
    const vych = platne.filter((u) => u.pozice === 'vychovatel_sd')
    const ost = platne.filter((u) => u.pozice !== 'vychovatel_sd')
    seznamy['1401:2'] = vych.map(popis)
    seznamy['1402:2'] = vych.filter((u) => u.interni).map(popis)
    seznamy['1403:2'] = vych.filter((u) => !u.interni).map(popis)
    seznamy['1404:2'] = ost.map(popis)
    seznamy['1404a:2'] = ost.filter((u) => u.pozice === 'asistent_pedagoga_sd').map(popis)
    seznamy['1405:2'] = ost.filter((u) => u.interni).map(popis)
    seznamy['1406:2'] = ost.filter((u) => !u.interni).map(popis)
  }

  /** Buňka výkazu podle klíče. */
  const c = (klic: string, desetinne = false) => {
    const p = !zmrazeno ? prepisy[klic] : undefined
    return (
      <Cislo
        hodnota={b[klic] ?? 0}
        jmena={zmrazeno ? undefined : seznamy[klic]}
        klic={klic}
        rok={rok}
        upravitelne={!zmrazeno}
        desetinne={desetinne}
        prepis={p ? { vypocteno: p.vypocteno, poznamka: p.poznamka, zastaraly: (zive[klic] ?? 0) !== p.vypocteno } : undefined}
      />
    )
  }
  const pocetPrepisu = Object.keys(prepisy).length
  const chybyDat = r.upozorneni.filter((u) => u.zavaznost === 'chyba').length

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-5 print:py-0">
      <div className="print:hidden">
        <Link href="/dashboard/msmt" className="text-xs text-gray-500 hover:underline">← MŠMT výkazy</Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Z 2-01 — výkaz o školní družině</h1>
          <p className="mt-1 text-sm text-gray-500">
            Stav k 31. 10. {rok} · IZO zařízení {env.izoDruziny} · RED_IZO {env.redIzo} · část 01
          </p>
          <p className="mt-1 text-xs text-gray-400 print:hidden">
            Vyplňuje se ve sberdat.uiv.cz (termín 2025 byl 11. 11.). Čísla přepište řádek po řádku;
            podtržené číslo ukáže, ze kterých dětí / pracovníků se skládá, ✎ hodnotu ručně přepíše.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {aktualni > 2026 && (
            <div className="flex gap-1 print:hidden">
              {Array.from({ length: aktualni - 2025 }, (_, i) => aktualni - i).slice(0, 3).map((y) => (
                <Link key={y} href={`/dashboard/msmt/z201?rok=${y}`}
                  className={`rounded px-2 py-1 text-xs ${y === rok ? 'bg-stone-800 text-white' : 'border border-gray-200 text-gray-600'}`}>
                  {y}
                </Link>
              ))}
            </div>
          )}
          <TiskButton />
        </div>
      </div>

      <ZmrazeniPanel
        rok={rok}
        zmrazeno={zmrazeno}
        kdy={zaznam?.zmrazeno_at ?? null}
        kdo={zmrazilJmeno}
        chybyDat={chybyDat}
        neplatneVazby={neprosle.length}
        rozdily={rozdily}
      />

      {/* Upozornění (jen živý výpočet) a kontroly */}
      <div className="space-y-2 print:hidden">
        {!zmrazeno && r.upozorneni.map((u, i) => (
          <div key={i} className={`rounded-md border px-3 py-2 text-xs ${
            u.zavaznost === 'chyba' ? 'border-red-200 bg-red-50 text-red-800'
            : u.zavaznost === 'varovani' ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
            {u.text}
            {u.ids && u.ids.length > 0 && <span className="block mt-0.5 text-[11px] opacity-80">{jmena(u.ids).join(', ')}</span>}
            {u.odkaz && <Link href={u.odkaz} className="ml-1 underline">Doplnit →</Link>}
          </div>
        ))}
        {!zmrazeno && pocetPrepisu > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Ručně přepsané buňky: {pocetPrepisu} (zvýrazněné). Zdůvodnění uveďte i v komentáři k výkazu ve sberdat.
            <span className="block mt-0.5 text-[11px] opacity-80">
              {Object.entries(prepisy).map(([k, p]) => `${k}: ${p.vypocteno} → ${p.hodnota} (${p.poznamka})`).join(' · ')}
            </span>
          </div>
        )}
        {neprosle.map((k, i) => (
          <div key={`k${i}`} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            Kontrolní vazba neplatí: {k.text}
          </div>
        ))}
        {neprosle.length === 0 && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            Všech {kontroly.length} kontrolních vazeb z metodického pokynu platí.
          </div>
        )}
      </div>

      {/* Oddíl I */}
      <Oddil nazev="I. Pravidelná denní docházka do školní družiny" popis="Účastníci přihlášení nejméně na 4 dny v týdnu po dobu nejméně 5 měsíců.">
        <table className="w-full">
          <thead><tr><th className={thL}>Řádek</th><th className={thL}></th><th className={th}>sl. 4 počet</th><th className={th}>sl. 5 dívky</th></tr></thead>
          <tbody>
            <tr><td className={tdR}>0101</td><td className={tdL}>Oddělení</td><td className={td}>{c('0101:4')}</td><td className={td}>X</td></tr>
            <tr><td className={tdR}>0101a</td><td className={tdL + ' pl-6 text-gray-500'}>z toho pro žáky § 16 odst. 9</td><td className={td}>{c('0101a:4')}</td><td className={td}>X</td></tr>
            <tr><td className={tdR}>0101b</td><td className={tdL}>Týdenní rozsah provozu (hod.)</td><td className={td}>{c('0101b:4', true)}</td><td className={td}>X</td></tr>
            <tr><td className={tdR}>0102</td><td className={tdL}>Účastníci</td><td className={td}>{c('0102:4')}</td><td className={td}>{c('0102:5')}</td></tr>
            <tr><td className={tdR}>0103</td><td className={tdL + ' pl-6'}>z 1. stupně</td><td className={td}>{c('0103:4')}</td><td className={td}>{c('0103:5')}</td></tr>
            <tr><td className={tdR}>0105</td><td className={tdL + ' pl-6'}>z 2. stupně</td><td className={td}>{c('0105:4')}</td><td className={td}>{c('0105:5')}</td></tr>
            {([
              ['0105a', 'z přípravné třídy ZŠ'], ['0105b', 'z přípravného stupně ZŠ speciální'], ['0106', 'ze ZŠ speciální'],
              ['0107', 'ze ZŠ zřízených podle § 16 odst. 9'], ['0107a', 'v odd. pro žáky § 16 odst. 9'], ['0107c', 'z ř. 0107a z 1. stupně'],
            ] as const).map(([x, nazev]) => (
              <tr key={x}><td className={tdR}>{x}</td><td className={tdL + ' pl-6 text-gray-400'}>{nazev}</td><td className={td}>{c(`${x}:4`)}</td><td className={td}>{c(`${x}:5`)}</td></tr>
            ))}
          </tbody>
        </table>
      </Oddil>

      {/* Oddíl V */}
      <Oddil nazev="V. Účastníci se speciálními vzdělávacími potřebami a nadaní" popis="Účastník je v tolika řádcích 0502 / 0503 / 0511, kolik má příčin; v 0501 jednou.">
        <table className="w-full">
          <thead><tr><th className={thL}>Řádek</th><th className={thL}></th><th className={th}>sl. 2 počet</th><th className={th}>sl. 3 dívky</th></tr></thead>
          <tbody>
            {RADKY_V.map(([k, nazev, uroven]) => (
              <tr key={k}>
                <td className={tdR}>{k}</td>
                <td className={tdL} style={{ paddingLeft: `${0.75 + uroven * 1.25}rem` }}>{nazev}</td>
                <td className={td}>{c(`${k}:2`)}</td>
                <td className={td}>{c(`${k}:3`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Oddil>

      {/* Oddíl IV */}
      <Oddil nazev="IV. Účastníci podle převažujícího stupně podpůrných opatření — běžná oddělení" popis="Stupeň z doporučení ŠPZ; 1. stupeň = PLPP bez doporučení.">
        <table className="w-full">
          <thead><tr><th className={thL}>Řádek</th><th className={thL}></th><th className={th}>sl. 4 počet</th><th className={th}>sl. 5 dívky</th></tr></thead>
          <tbody>
            {['0401', '0402', '0403', '0404', '0405', '0406'].map((k, i) => (
              <tr key={k}>
                <td className={tdR}>{k}</td>
                <td className={tdL}>{i < 5 ? `${i + 1}. stupeň` : 'Celkem'}</td>
                <td className={td}>{c(`${k}:4`)}</td>
                <td className={td}>{c(`${k}:5`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Oddil>

      {/* Oddíl IX */}
      <Oddil nazev="IX. Účastníci se zdravotním postižením podle druhu" popis="Jen zdravotní postižení § 16 odst. 9 zjištěné ŠPZ (identifikátor znevýhodnění). Sl. 2b = PO 2.–5. stupně poskytovaná družinou.">
        <table className="w-full">
          <thead><tr><th className={thL}>Řádek</th><th className={thL}></th><th className={th}>sl. 2 celkem</th><th className={th}>sl. 2a dívky</th><th className={th}>sl. 2b</th></tr></thead>
          <tbody>
            {[...RADKY_IX_NAZVY, { r: '0919', nazev: 'z toho v odd. § 16 odst. 9', odsazeni: true }].map(({ r: k, nazev, odsazeni }) => (
              <tr key={k}>
                <td className={tdR}>{k}</td>
                <td className={tdL + (odsazeni ? ' pl-6 text-gray-500' : '')}>{nazev}</td>
                <td className={td}>{c(`${k}:2`)}</td>
                <td className={td}>{c(`${k}:2a`)}</td>
                <td className={td}>{c(`${k}:2b`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Oddil>

      {/* Oddíl XIV */}
      <Oddil nazev="XIV. Evidenční počet pedagogických pracovníků" popis={`Z úvazků zadaných ve Správě školy. Externí přepočet = hodiny za říjen / ${vstup.hodinyRijna} h.`}>
        <table className="w-full">
          <thead><tr><th className={thL}>Řádek</th><th className={thL}></th><th className={th}>sl. 2 fyzické osoby</th><th className={th}>sl. 3 ženy</th><th className={th}>sl. 4 přepočtení</th></tr></thead>
          <tbody>
            {RADKY_XIV.map(([k, nazev, odsazeni]) => (
              <tr key={k}>
                <td className={tdR}>{k}</td>
                <td className={tdL + (odsazeni ? ' pl-6 text-gray-500' : '')}>{nazev}</td>
                <td className={td}>{c(`${k}:2`)}</td>
                <td className={td}>{c(`${k}:3`)}</td>
                <td className={td}>{c(`${k}:4`, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-gray-400 print:hidden">
          <Link href={`/dashboard/sprava-skoly/uvazky?rdat=${vstup.rdat}`} className="text-blue-600 underline">Upravit úvazky →</Link>
        </p>
      </Oddil>

      {/* Oddíl XXI */}
      <Oddil nazev="XXI. Účastníci podle státního občanství, cizinci podle režimu pobytu" popis="Účastníci se zdravotním postižením (oddíl IX) mají za každý stát samostatný řádek se sl. c = ano.">
        <table className="w-full">
          <thead>
            <tr>
              <th className={thL}>sl. a kód</th><th className={thL}>sl. b stát</th><th className={thL}>sl. c zdr. post.</th>
              <th className={th}>sl. 2 celkem</th><th className={th}>sl. 4 dívky</th><th className={th}>sl. 5 trvalý pobyt</th>
              <th className={th}>sl. 7a azyl</th><th className={th}>sl. 7b dopl. ochrana</th><th className={th}>sl. 7c doč. ochrana</th>
            </tr>
          </thead>
          <tbody>
            {radkyXXI(b).map((x) => {
              const p = `XXI:${x.stpr}:${x.zdravotniPostizeni ? 'ano' : 'ne'}`
              return (
                <tr key={p}>
                  <td className={tdR}>{x.stpr}</td>
                  <td className={tdL}>{nazevStatu(x.stpr)}</td>
                  <td className={tdL}>{x.zdravotniPostizeni ? 'ano' : 'ne'}</td>
                  {['2', '4', '5', '7a', '7b', '7c'].map((sl) => <td key={sl} className={td}>{c(`${p}:${sl}`)}</td>)}
                </tr>
              )
            })}
            {radkyXXI(b).length === 0 && (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-sm text-gray-400">Žádní účastníci.</td></tr>
            )}
          </tbody>
        </table>
      </Oddil>

      <p className="text-xs text-gray-400">
        Oddíly VI a VII vyplňují jen školní kluby. Kontrolní vazby: {kontroly.filter((k) => k.ok).length} / {kontroly.length} platí.
      </p>
    </div>
  )
}
