/**
 * lib/enrollment/pdf/oznameni.tsx
 *
 * PDF „Oznámení řediteli školy" — dvě varianty:
 *  - spadova   … oznámení spádové škole o přijetí (§ 36 odst. 5), u zápisu
 *  - dosavadni … oznámení dosavadní škole o přestupu + žádost o dokumentaci
 *                ze školní matriky (§ 49 odst. 1), u přestupu
 *
 * Znění 1:1 podle vzorů dodaných školou (2025/2026). Adresát (název školy,
 * jméno ředitele/ředitelky, oslovení) se pro F1 zadává ručně na detailu case
 * a předává route handlerem — spádovost zatím nemáme z dat (časem NPI API).
 */

import 'server-only'
import { renderToBuffer } from '@react-pdf/renderer'
import { Text, View } from '@react-pdf/renderer'
import { DopisPage, Podpis, ensureFont, mistoDatum, s, SKOLA } from './layout'

export type OznameniKind = 'spadova' | 'dosavadni'

export interface OznameniData {
  // žák
  jmeno: string
  prijmeni: string
  rodne_cislo: string | null
  bydliste: string // už zformátovaná adresa „ulice číslo, PSČ obec"
  // datum přijetí (nástupu) — např. „1. 9. 2026"
  datum_nastupu: string | null
  // datum vyhotovení dokumentu (deterministicky = datum rozhodnutí)
  datum_dokumentu: string | null
  // adresát (ručně zadaný ředitelem)
  adresat_skola: string
  adresat_reditel: string
  osloveni: string // „Vážená paní ředitelko" / „Vážený pane řediteli"
}

const TITULEK: Record<OznameniKind, string[]> = {
  spadova: ['Oznámení řediteli spádové školy', 'o přijetí žáka k základnímu vzdělávání'],
  dosavadni: ['Oznámení řediteli základní školy', 'o přestupu žáka'],
}

const PARAGRAF: Record<OznameniKind, string> = {
  spadova: '§ 36 odst. 5',
  dosavadni: '§ 49 odst. 1',
}

// Uzavírací věta specifická pro variantu.
const ZAVER: Record<OznameniKind, string> = {
  spadova: 'Žák místem svého trvalého pobytu spadá do spádové oblasti vaší školy.',
  dosavadni: 'Žádám tímto o předání dokumentace ze školní matriky.',
}

function OznameniDocument({ kind, d }: { kind: OznameniKind; d: OznameniData }) {
  const titulek = TITULEK[kind]
  const jmenoCele = `${d.jmeno} ${d.prijmeni}`.trim()
  const rc = d.rodne_cislo ?? '—'
  const kDatu = d.datum_nastupu ?? '—'

  return (
    <DopisPage title={`${titulek.join(' — ')} · ${jmenoCele}`}>
      {/* název dokumentu */}
      <View style={s.docTitleBlock}>
        {titulek.map((r, i) => (
          <Text key={i} style={s.docTitle}>
            {r}
          </Text>
        ))}
      </View>

      {/* místo a datum */}
      <Text style={s.mistoDatum}>{mistoDatum(d.datum_dokumentu)}</Text>

      {/* adresát */}
      <View style={s.adresat}>
        {d.adresat_skola
          .split('\n')
          .filter((r) => r.trim())
          .map((r, i) => (
            <Text key={`sk-${i}`} style={s.adresatRadek}>
              {r}
            </Text>
          ))}
        {d.adresat_reditel.trim() ? (
          <Text style={s.adresatRadek}>{d.adresat_reditel}</Text>
        ) : null}
      </View>

      {/* oslovení */}
      <Text style={s.osloveni}>{d.osloveni.trim() ? `${d.osloveni.trim()},` : ''}</Text>

      {/* tělo */}
      <Text style={s.odstavec}>
        Jako ředitel základní školy, jejíž činnost vykonává {SKOLA.nazev} se sídlem {SKOLA.adresa},
        RED IZO {SKOLA.redIzo}, IČO: {SKOLA.ico} Vám podle {PARAGRAF[kind]} zákona č. 561/2004 Sb.
        školský zákon oznamuji, že jsem k základnímu vzdělávání v {SKOLA.nazevKratky} přijal k {kDatu}
      </Text>

      {/* žák */}
      <View style={s.zakBlok}>
        <Text style={s.zakRadek}>
          {jmenoCele}, RČ {rc}
        </Text>
        <Text style={s.zakRadek}>trvalým bydlištěm {d.bydliste}</Text>
      </View>

      {/* uzavírací věta */}
      <Text style={s.odstavec}>{ZAVER[kind]}</Text>

      <Text style={s.odstavec}>S pozdravem</Text>

      <Podpis />
    </DopisPage>
  )
}

export async function renderOznameniPdf(kind: OznameniKind, d: OznameniData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<OznameniDocument kind={kind} d={d} />)
}
