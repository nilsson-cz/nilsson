/**
 * lib/enrollment/pdf/prijeti.tsx
 *
 * „Rozhodnutí o přijetí k základnímu vzdělávání" (§ 46 odst. 1, § 165 odst. 2
 * písm. e) školského zákona).
 *
 * Právní režim (viz § 183 odst. 2 škol. z. + § 67 odst. 2 spr. řádu): přijetí se
 * OZNAMUJE zveřejněním seznamu přijatých pod registračním číslem; písemné
 * rozhodnutí se vyhotovuje do spisu, ale přijatým se NEDORUČUJE (vyzvednutí na
 * vyžádání). Tento dokument je právě to písemné rozhodnutí do spisu.
 *
 * Odůvodnění není povinné — při plném vyhovění žádosti ho lze vypustit
 * (§ 68 odst. 4 spr. řádu); proto je volitelné a při prázdném se sekce
 * nevykreslí. Znění odvozeno z hromadného vzoru školy + § odkazů.
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

export interface PrijetiData {
  zz_jmeno: string
  zz_adresa_radky: string[]
  zz_adresa_doruceni: string
  dite_jmeno: string
  dite_narozeni: string | null
  dite_adresa: string
  cislo_jednaci: string | null
  spisova_znacka: string | null
  datum_vydani: string | null
  skolni_rok: string // „2026/2027"
  oduvodneni: string // volitelné (§ 68 odst. 4 spr. řádu)
}

function odstavce(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length > 0)
}

function PrijetiDocument({ d }: { d: PrijetiData }) {
  const diteNar = fmtDate(d.dite_narozeni)
  const oduvodneniOdst = odstavce(d.oduvodneni)

  return (
    <FormalPage title={`Rozhodnutí o přijetí — ${d.dite_jmeno}`}>
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
      <Text style={sf.docSub}>o přijetí k základnímu vzdělávání</Text>

      <Text style={sf.sekceNadpis}>Účastník řízení</Text>
      <Text style={sf.odstavec}>
        Dítě: {d.dite_jmeno}, nar. {diteNar}, trvalý pobyt: {d.dite_adresa}
        {'\n'}Zákonný zástupce: {d.zz_jmeno}, adresa pro doručování: {d.zz_adresa_doruceni}
      </Text>

      <Text style={sf.sekceNadpis}>Výrok</Text>
      <Text style={sf.odstavec}>
        Ředitel {SKOLA.nazevGenitiv}, jako věcně a místně příslušný správní orgán podle § 165 odst. 2
        písm. e) zákona č. 561/2004 Sb., o předškolním, základním, středním, vyšším odborném a jiném
        vzdělávání (školský zákon), ve znění pozdějších předpisů, rozhodl podle § 46 odst. 1 školského
        zákona a v souladu se zákonem č. 500/2004 Sb., správní řád, ve znění pozdějších předpisů, takto:
      </Text>
      <Text style={[sf.odstavec, { textAlign: 'center' }]}>
        Dítě {d.dite_jmeno}, nar. {diteNar}, se přijímá k základnímu vzdělávání v {SKOLA.nazevLokal} od
        školního roku {d.skolni_rok}.
      </Text>

      {oduvodneniOdst.length > 0 && (
        <>
          <Text style={sf.sekceNadpis}>Odůvodnění</Text>
          {oduvodneniOdst.map((p, i) => (
            <Text key={i} style={sf.odstavec}>
              {p}
            </Text>
          ))}
        </>
      )}

      <Text style={sf.sekceNadpis}>Poučení</Text>
      <Text style={sf.odstavec}>
        Proti tomuto rozhodnutí lze podat odvolání ve lhůtě 15 dnů ode dne jeho doručení. Odvolání se
        podává u ředitele {SKOLA.nazevGenitiv} a rozhoduje o něm {ODVOLACI.nazev}, {ODVOLACI.adresa}.
      </Text>
      <Text style={sf.odstavec}>
        O přijetí dítěte bylo v souladu s § 67 odst. 2 správního řádu vyhotoveno písemné rozhodnutí,
        které je součástí spisu dítěte ve škole. Přijatým dětem se rozhodnutí v písemné podobě
        nedoručuje; vyzvednutí je možné na vyžádání u ředitele školy. Přijetí se oznamuje zveřejněním
        seznamu přijatých uchazečů pod registračním číslem (§ 183 odst. 2 školského zákona).
      </Text>

      <PodpisFormal datum={d.datum_vydani} />
    </FormalPage>
  )
}

export async function renderPrijetiPdf(d: PrijetiData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<PrijetiDocument d={d} />)
}
