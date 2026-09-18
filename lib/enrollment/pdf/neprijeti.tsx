/**
 * lib/enrollment/pdf/neprijeti.tsx
 *
 * „Rozhodnutí o nepřijetí k základnímu vzdělávání" — zamítnutí žádosti o přijetí
 * (§ 46 odst. 1 a § 36 odst. 4 školského zákona, § 165 odst. 2 písm. e). Na
 * rozdíl od rozhodnutí o přijetí se DORUČUJE do vlastních rukou ZZ (§ 183 odst. 3
 * škol. z.), proto se generuje individuálně pro každé dítě.
 *
 * Znění 1:1 podle vzoru školy (2026). Hlavička/výrok/poučení z dat a fixního
 * práva; odůvodnění (podklady, kritéria, bodování, výsledek řízení) píše ředitel
 * do formuláře — je case-specific a v datech ho nemáme.
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

export interface NeprijetiData {
  // zákonný zástupce (adresát / doručování)
  zz_jmeno: string
  zz_adresa_radky: string[]
  zz_adresa_doruceni: string
  // dítě
  dite_jmeno: string
  dite_narozeni: string | null
  dite_adresa: string
  // eSSL
  cislo_jednaci: string | null
  spisova_znacka: string | null
  datum_vydani: string | null
  // proměnné
  skolni_rok: string // „2026/2027"
  oduvodneni: string // volný text ředitele (víceodstavcový)
  prilohy: string // volný text, jedna položka na řádek (default „žádné")
}

function odstavce(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length > 0)
}

function radky(text: string): string[] {
  return text.split('\n').map((r) => r.trim()).filter((r) => r.length > 0)
}

function NeprijetiDocument({ d }: { d: NeprijetiData }) {
  const diteNar = fmtDate(d.dite_narozeni)
  const oduvodneniOdst = odstavce(d.oduvodneni)
  const prilohyRadky = radky(d.prilohy)

  return (
    <FormalPage title={`Rozhodnutí o nepřijetí — ${d.dite_jmeno}`}>
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
      <Text style={sf.docSub}>o nepřijetí k základnímu vzdělávání</Text>

      <Text style={sf.sekceNadpis}>Účastník řízení</Text>
      <Text style={sf.odstavec}>
        Dítě: {d.dite_jmeno}, nar. {diteNar}, trvalý pobyt: {d.dite_adresa}
        {'\n'}Zákonný zástupce: {d.zz_jmeno}, adresa pro doručování: {d.zz_adresa_doruceni}
      </Text>

      <Text style={sf.sekceNadpis}>I. Výrok</Text>
      <Text style={sf.odstavec}>
        Ředitel {SKOLA.nazevGenitiv} (dále jen „škola“), jako věcně a místně příslušný správní orgán
        podle § 165 odst. 2 písm. e) zákona č. 561/2004 Sb., o předškolním, základním, středním, vyšším
        odborném a jiném vzdělávání (školský zákon), ve znění pozdějších předpisů, rozhodl podle § 46
        odst. 1 a § 36 odst. 4 školského zákona a v souladu se zákonem č. 500/2004 Sb., správní řád, ve
        znění pozdějších předpisů, takto:
      </Text>
      <Text style={[sf.odstavec, { textAlign: 'center' }]}>
        Žádost o přijetí dítěte {d.dite_jmeno}, nar. {diteNar}, k základnímu vzdělávání v{' '}
        {SKOLA.nazevLokal} od školního roku {d.skolni_rok}
      </Text>
      <Text style={sf.vyrok}>se zamítá.</Text>

      <Text style={sf.sekceNadpis}>II. Odůvodnění</Text>
      {oduvodneniOdst.length > 0 ? (
        oduvodneniOdst.map((p, i) => (
          <Text key={i} style={sf.odstavec}>
            {p}
          </Text>
        ))
      ) : (
        <Text style={[sf.odstavec, { color: C.warn }]}>[Doplňte odůvodnění.]</Text>
      )}

      <Text style={sf.sekceNadpis}>III. Poučení</Text>
      <Text style={sf.odstavec}>
        Proti tomuto rozhodnutí lze podat odvolání ve lhůtě 15 dnů ode dne jeho oznámení (doručení).
        Odvolání se podává u ředitele školy, který toto rozhodnutí vydal. O odvolání rozhoduje{' '}
        {ODVOLACI.nazev}, odbor školství, mládeže a tělovýchovy, {ODVOLACI.adresa}.
      </Text>
      <Text style={sf.odstavec}>
        Odvolání lze podat písemně nebo ústně do protokolu. Z odvolání musí být patrno, kdo je činí,
        které věci se týká a co se navrhuje (§ 37 odst. 2 a § 82 odst. 2 správního řádu).
      </Text>
      <Text style={sf.odstavec}>Včas podané a přípustné odvolání má odkladný účinek.</Text>

      <PodpisFormal datum={d.datum_vydani} />

      <Text style={[sf.metaRadek, { marginTop: 14, color: C.muted }]}>
        Rozhodnutí se doručuje do vlastních rukou zákonného zástupce.
      </Text>

      {prilohyRadky.length > 0 && (
        <View wrap={false}>
          <Text style={sf.sekceNadpis}>Přílohy</Text>
          {prilohyRadky.map((r, i) => (
            <View key={i} style={sf.odrazka}>
              <Text style={sf.odrazkaBod}>•</Text>
              <Text style={sf.odrazkaText}>{r}</Text>
            </View>
          ))}
        </View>
      )}
    </FormalPage>
  )
}

export async function renderNeprijetiPdf(d: NeprijetiData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<NeprijetiDocument d={d} />)
}
