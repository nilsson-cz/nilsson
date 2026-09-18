/**
 * lib/enrollment/pdf/zamitnuti-zastaveni.tsx
 *
 * Dva formální akty odvozené z legislativy (vzor školy chybí):
 *  - renderPrestupZamitnutPdf … „Rozhodnutí o zamítnutí přestupu" (§ 49 odst. 1
 *    školského zákona; ředitel rozhoduje ve správním řízení, nejčastější důvod
 *    naplněná kapacita, odvolání ke KÚ, má odkladný účinek). Doručuje se ZZ.
 *  - renderZastaveniPdf … „Usnesení o zastavení řízení" (§ 66 odst. 1 správního
 *    řádu). Dva důvody: písm. a) zpětvzetí žádosti (storno rodičem) a písm. g)
 *    zjevná bezpředmětnost (typicky nedostavili se / přijati jinde). Odvolání
 *    proti usnesení nemá odkladný účinek (§ 76 odst. 5 spr. řádu).
 *
 * Znění je konstruováno z právních ustanovení a obvyklé praxe, odůvodnění píše
 * ředitel do formuláře. Před vydáním nechť ředitel znění zkontroluje.
 */

import 'server-only'
import { renderToBuffer, Text, View } from '@react-pdf/renderer'
import {
  FormalPage,
  FormalniHlavicka,
  PodpisFormal,
  ensureFont,
  fmtDate,
  sf,
  C,
  ODVOLACI,
  SKOLA,
} from './layout'

function odstavce(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length > 0)
}

// ── Rozhodnutí o zamítnutí přestupu ──────────────────────────────────────

export interface PrestupZamitnutData {
  zz_jmeno: string
  zz_adresa_radky: string[]
  zz_adresa_doruceni: string
  dite_jmeno: string
  dite_narozeni: string | null
  dite_adresa: string
  cislo_jednaci: string | null
  spisova_znacka: string | null
  datum_vydani: string | null
  prestup_k_datu: string // text, k jakému datu byl přestup žádán (nepovinné)
  oduvodneni: string // volný text ředitele (typicky naplněná kapacita)
}

function PrestupZamitnutDocument({ d }: { d: PrestupZamitnutData }) {
  const diteNar = fmtDate(d.dite_narozeni)
  const oduvodneniOdst = odstavce(d.oduvodneni)

  return (
    <FormalPage title={`Rozhodnutí o zamítnutí přestupu — ${d.dite_jmeno}`}>
      <FormalniHlavicka
        adresatRadky={[d.zz_jmeno, ...d.zz_adresa_radky]}
        cisloJednaci={d.cislo_jednaci}
        datumVydani={d.datum_vydani}
      />
      {d.spisova_znacka ? (
        <Text style={[sf.metaRadek, { color: C.muted }]}>Spisová značka: {d.spisova_znacka}</Text>
      ) : null}

      <View style={sf.divider} />
      <Text style={sf.docTitle}>ROZHODNUTÍ</Text>
      <Text style={sf.docSub}>o zamítnutí přestupu žáka</Text>

      <Text style={sf.sekceNadpis}>Účastník řízení</Text>
      <Text style={sf.odstavec}>
        Žák: {d.dite_jmeno}, nar. {diteNar}, trvalý pobyt: {d.dite_adresa}
        {'\n'}Zákonný zástupce: {d.zz_jmeno}, adresa pro doručování: {d.zz_adresa_doruceni}
      </Text>

      <Text style={sf.sekceNadpis}>Výrok</Text>
      <Text style={sf.odstavec}>
        Ředitel {SKOLA.nazevGenitiv}, jako věcně a místně příslušný správní orgán podle § 165 odst. 2
        písm. e) zákona č. 561/2004 Sb., o předškolním, základním, středním, vyšším odborném a jiném
        vzdělávání (školský zákon), ve znění pozdějších předpisů, rozhodl podle § 49 odst. 1 školského
        zákona a v souladu se zákonem č. 500/2004 Sb., správní řád, ve znění pozdějších předpisů, takto:
      </Text>
      <Text style={[sf.odstavec, { textAlign: 'center' }]}>
        Žádost zákonného zástupce o přestup žáka {d.dite_jmeno}, nar. {diteNar},
        {d.prestup_k_datu.trim() ? ` k ${d.prestup_k_datu.trim()}` : ''} do {SKOLA.nazevGenitiv}
      </Text>
      <Text style={sf.vyrok}>se zamítá.</Text>

      <Text style={sf.sekceNadpis}>Odůvodnění</Text>
      {oduvodneniOdst.length > 0 ? (
        oduvodneniOdst.map((p, i) => (
          <Text key={i} style={sf.odstavec}>
            {p}
          </Text>
        ))
      ) : (
        <Text style={[sf.odstavec, { color: C.warn }]}>[Doplňte odůvodnění.]</Text>
      )}

      <Text style={sf.sekceNadpis}>Poučení</Text>
      <Text style={sf.odstavec}>
        Proti tomuto rozhodnutí lze podat odvolání ve lhůtě 15 dnů ode dne jeho doručení. Odvolání se
        podává u ředitele {SKOLA.nazevGenitiv} a rozhoduje o něm {ODVOLACI.nazev}, {ODVOLACI.adresa}.
      </Text>
      <Text style={sf.odstavec}>
        Odvolání lze podat písemně nebo ústně do protokolu. Včas podané a přípustné odvolání má odkladný
        účinek.
      </Text>

      <PodpisFormal datum={d.datum_vydani} />

      <Text style={[sf.metaRadek, { marginTop: 14, color: C.muted }]}>
        Rozhodnutí se doručuje do vlastních rukou zákonného zástupce.
      </Text>
    </FormalPage>
  )
}

export async function renderPrestupZamitnutPdf(d: PrestupZamitnutData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<PrestupZamitnutDocument d={d} />)
}

// ── Usnesení o zastavení řízení ──────────────────────────────────────────

export type ZastaveniDuvod = 'zpetvzeti' | 'bezpredmetna'

export interface ZastaveniData {
  typ: 'zapis' | 'prestup'
  zz_jmeno: string
  zz_adresa_radky: string[]
  dite_jmeno: string
  dite_narozeni: string | null
  cislo_jednaci: string | null
  datum_vydani: string | null
  skolni_rok: string
  duvod: ZastaveniDuvod
  datum_udalosti: string | null // datum zpětvzetí / rozhodné události
  oduvodneni: string // volný text ředitele (doplní konkrétní okolnosti)
}

const ZASTAVENI_PISMENO: Record<ZastaveniDuvod, string> = {
  zpetvzeti: 'a)',
  bezpredmetna: 'g)',
}

function ZastaveniDocument({ d }: { d: ZastaveniData }) {
  const diteNar = fmtDate(d.dite_narozeni)
  const pismeno = ZASTAVENI_PISMENO[d.duvod]
  const oduvodneniOdst = odstavce(d.oduvodneni)

  const predmet =
    d.typ === 'prestup'
      ? `o přestup žáka ${d.dite_jmeno}, nar. ${diteNar}, do ${SKOLA.nazevGenitiv}`
      : `o přijetí dítěte ${d.dite_jmeno}, nar. ${diteNar}, k základnímu vzdělávání v ${SKOLA.nazevLokal} od školního roku ${d.skolni_rok}`

  return (
    <FormalPage title={`Usnesení o zastavení řízení — ${d.dite_jmeno}`}>
      <FormalniHlavicka
        adresatRadky={[d.zz_jmeno, ...d.zz_adresa_radky]}
        cisloJednaci={d.cislo_jednaci}
        datumVydani={d.datum_vydani}
      />

      <View style={sf.divider} />
      <Text style={sf.docTitle}>USNESENÍ</Text>
      <Text style={sf.docSub}>o zastavení řízení</Text>

      <Text style={[sf.odstavec, { marginTop: 10 }]}>
        Ředitel {SKOLA.nazevGenitiv}, jako věcně a místně příslušný správní orgán podle § 165 odst. 2
        písm. e) zákona č. 561/2004 Sb., školský zákon, ve znění pozdějších předpisů, rozhodl v souladu
        s § 66 odst. 1 písm. {pismeno} zákona č. 500/2004 Sb., správní řád, ve znění pozdějších předpisů,
        takto:
      </Text>

      <Text style={sf.sekceNadpis}>Výrok</Text>
      <Text style={[sf.odstavec, { textAlign: 'center' }]}>
        Řízení o žádosti zákonného zástupce {d.zz_jmeno} {predmet}
      </Text>
      <Text style={sf.vyrok}>se zastavuje.</Text>

      <Text style={sf.sekceNadpis}>Odůvodnění</Text>
      {d.duvod === 'zpetvzeti' ? (
        <Text style={sf.odstavec}>
          Zákonný zástupce {d.zz_jmeno} vzal dne {fmtDate(d.datum_udalosti)} svou žádost zpět. Podle
          § 66 odst. 1 písm. a) správního řádu správní orgán řízení o žádosti usnesením zastaví, vzal-li
          žadatel svou žádost zpět. Správní orgán proto rozhodl tak, jak je uvedeno ve výroku.
        </Text>
      ) : (
        <Text style={sf.odstavec}>
          V průběhu řízení se žádost stala zjevně bezpředmětnou. Podle § 66 odst. 1 písm. g) správního
          řádu správní orgán řízení o žádosti usnesením zastaví, stala-li se žádost zjevně bezpředmětnou.
          Správní orgán proto rozhodl tak, jak je uvedeno ve výroku.
        </Text>
      )}
      {oduvodneniOdst.map((p, i) => (
        <Text key={i} style={sf.odstavec}>
          {p}
        </Text>
      ))}

      <Text style={sf.sekceNadpis}>Poučení</Text>
      <Text style={sf.odstavec}>
        Proti tomuto usnesení lze podat odvolání do 15 dnů ode dne jeho oznámení (doručení) ke{' '}
        {ODVOLACI.nazevDativ} prostřednictvím {SKOLA.nazevGenitiv}. Podle § 76 odst. 5 správního řádu
        nemá odvolání proti tomuto usnesení odkladný účinek.
      </Text>

      <PodpisFormal datum={d.datum_vydani} />

      <Text style={[sf.metaRadek, { marginTop: 14, color: C.muted }]}>
        Usnesení se oznamuje (doručuje) zákonnému zástupci.
      </Text>
    </FormalPage>
  )
}

export async function renderZastaveniPdf(d: ZastaveniData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<ZastaveniDocument d={d} />)
}
