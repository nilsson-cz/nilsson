/**
 * lib/potvrzeni-o-studiu/pdf.tsx
 *
 * PDF „Potvrzení o studiu" (o tom, že dítě je žákem školy). Generuje si ho
 * zákonný zástupce v rodičovském portálu. Server-only, @react-pdf/renderer.
 *
 * Náležitosti: 1) identifikace školy (název dle rejstříku, sídlo, IČO, RED IZO,
 * kontakt), 2) identifikace žáka (jméno, datum narození, volitelně RČ,
 * bydliště), 3) údaje o vzdělávání (školní rok, třída/ročník, text o plnění
 * PŠD dle § 36/38/41 ŠZ, od 15 let i soustavná příprava na povolání),
 * 4) formální náležitosti (datum vydání, místo pro podpis oprávněné osoby
 * a otisk razítka).
 *
 * Podpis a razítko: sken z privátního bucketu skola-podpis (nahrává ředitel
 * v Nastavení; do veřejného repa nepatří). Když chybí, zůstane linka/kruh
 * k ručnímu doplnění. Pravost ověřuje kód + QR na /overeni/<kód> (migrace 170).
 * Hlavička + font sdíleny s formálními PDF zápisu (lib/enrollment/pdf/layout).
 */

import 'server-only'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { ensureFont, SKOLA, C, s as base, fmtDate, mistoDatum, BrandFooter } from '@/lib/enrollment/pdf/layout'
import type { ParagrafPsd } from '@/lib/zpusob-psd'

export interface PotvrzeniData {
  zak: {
    jmeno: string
    datum_narozeni: string | null
    rodne_cislo: string | null // null = neuvádět
    bydliste: string | null
    zena: boolean | null // null = neznámo → „žák/žákyně"
    od: string | null // datum zahájení vzdělávání ve škole
  }
  skolni_rok: string
  trida: string | null
  rocnik: number | null
  paragraf: ParagrafPsd
  pripravaNaPovolani: boolean
  ucel: string | null
  datum_vydani: string
  /** Ověření pravosti (null = bez evidence, např. testovací render). */
  overeni: { kod: string; url: string; qr: string; plati_do: string } | null
  /** Sken jako data URI; null = ruční podpis/razítko. */
  podpis: string | null
  razitko: string | null
}

const st = StyleSheet.create({
  hlNazev: { fontSize: 12, marginBottom: 2 },
  hlRadek: { fontSize: 9, color: C.muted },
  divider: { borderBottomWidth: 0.5, borderBottomColor: C.line, marginVertical: 14 },
  title: { fontSize: 18, textAlign: 'center', letterSpacing: 2, marginTop: 18, marginBottom: 22 },
  odst: { marginBottom: 10, textAlign: 'justify' },
  zakBlok: {
    marginVertical: 10,
    marginHorizontal: 30,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 0.5,
    borderColor: C.line,
  },
  zakJmeno: { fontSize: 14, textAlign: 'center', marginBottom: 6 },
  zakRadek: { flexDirection: 'row', marginBottom: 2 },
  zakLabel: { width: 110, color: C.muted, fontSize: 10 },
  zakHodnota: { flex: 1, fontSize: 10.5 },
  paticka: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 36 },
  razitko: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 0.5,
    borderColor: C.line,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  razitkoText: { fontSize: 8, color: C.muted, textAlign: 'center' },
  razitkoImg: { width: 110, height: 110, objectFit: 'contain' },
  podpis: { width: 220, alignItems: 'center' },
  podpisImg: { height: 52, maxWidth: 200, objectFit: 'contain', marginBottom: 2 },
  podpisLinka: { borderTopWidth: 0.5, borderTopColor: C.lineStrong, width: '100%', marginBottom: 4 },
  podpisJmeno: { fontSize: 10.5 },
  podpisFunkce: { fontSize: 9.5, color: C.muted },
  pozn: { fontSize: 8.5, color: C.muted, marginTop: 20 },
  overeni: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 10,
    borderWidth: 0.5,
    borderColor: C.line,
  },
  qr: { width: 64, height: 64, marginRight: 12 },
  overeniNadpis: { fontSize: 9.5, marginBottom: 2 },
  overeniText: { fontSize: 8.5, color: C.muted },
  overeniKod: { fontSize: 11, letterSpacing: 1, marginVertical: 2 },
})

function ZakRadek({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.zakRadek}>
      <Text style={st.zakLabel}>{label}</Text>
      <Text style={st.zakHodnota}>{value}</Text>
    </View>
  )
}

function PotvrzeniDoc({ d }: { d: PotvrzeniData }) {
  const zena = d.zak.zena
  const zakem = zena === null ? 'žákem/žákyní' : zena ? 'žákyní' : 'žákem'
  const zakNom = zena === null ? 'Žák/žákyně' : zena ? 'Žákyně' : 'Žák'
  const radnym = zena === null ? 'řádným žákem/řádnou žákyní' : zena ? 'řádnou žákyní' : 'řádným žákem'

  const tridaText = [
    d.rocnik ? `${d.rocnik}. ročníku` : null,
    d.trida ? `třídy ${d.trida}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  const pravniText =
    d.paragraf === '41'
      ? `${zakNom} plní povinnou školní docházku formou individuálního vzdělávání podle § 41 zákona č. 561/2004 Sb., školského zákona, jako ${zakem} této školy.`
      : d.paragraf === '38'
        ? `${zakNom} plní povinnou školní docházku podle § 38 zákona č. 561/2004 Sb., školského zákona; tato škola je ${zena ? 'její' : zena === false ? 'jeho' : 'jeho/její'} kmenovou školou.`
        : `${zakNom} je ${radnym} školy a plní zde povinnou školní docházku podle zákona č. 561/2004 Sb., školského zákona.`

  return (
    <Document title={`Potvrzení o studiu – ${d.zak.jmeno}`} author={SKOLA.nazev}>
      <Page size="A4" style={base.page}>
        {/* 1. Identifikace školy (hlavička) */}
        <View>
          <Text style={st.hlNazev}>{SKOLA.nazev}</Text>
          <Text style={st.hlRadek}>se sídlem {SKOLA.adresa}</Text>
          <Text style={st.hlRadek}>
            IČO: {SKOLA.ico}   ·   RED IZO: {SKOLA.redIzo}
            {SKOLA.ds ? `   ·   datová schránka: ${SKOLA.ds}` : ''}
          </Text>
          {SKOLA.web ? <Text style={st.hlRadek}>{SKOLA.web}</Text> : null}
        </View>
        <View style={st.divider} />

        <Text style={st.title}>POTVRZENÍ O STUDIU</Text>

        <Text style={st.odst}>
          Ředitel {SKOLA.nazevGenitiv} tímto potvrzuje, že
        </Text>

        {/* 2. Identifikace žáka */}
        <View style={st.zakBlok} wrap={false}>
          <Text style={st.zakJmeno}>{d.zak.jmeno}</Text>
          <ZakRadek label="datum narození:" value={fmtDate(d.zak.datum_narozeni)} />
          {d.zak.rodne_cislo ? <ZakRadek label="rodné číslo:" value={d.zak.rodne_cislo} /> : null}
          <ZakRadek label="bydliště:" value={d.zak.bydliste ?? '—'} />
        </View>

        {/* 3. Údaje o vzdělávání */}
        <Text style={st.odst}>
          je ve školním roce {d.skolni_rok} {zakem}
          {tridaText ? ` ${tridaText}` : ''} výše uvedené základní školy
          {d.zak.od ? ` (ve škole od ${fmtDate(d.zak.od)})` : ''}.
        </Text>
        <Text style={st.odst}>
          {pravniText}
          {d.pripravaNaPovolani ? ` ${zakNom} se tak soustavně připravuje na budoucí povolání.` : ''}
        </Text>
        <Text style={st.odst}>
          Potvrzení se vydává na žádost zákonného zástupce
          {d.ucel ? ` pro účely: ${d.ucel}` : ''}. Údaje odpovídají stavu ke dni vydání.
        </Text>

        {/* 4. Formální náležitosti */}
        <Text style={{ marginTop: 18 }}>{mistoDatum(d.datum_vydani)}</Text>

        <View style={st.paticka} wrap={false}>
          {d.razitko ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image nemá alt
            <Image src={d.razitko} style={st.razitkoImg} />
          ) : (
            <View style={st.razitko}>
              <Text style={st.razitkoText}>otisk razítka{'\n'}školy</Text>
            </View>
          )}
          <View style={st.podpis}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image nemá alt */}
            {d.podpis ? <Image src={d.podpis} style={st.podpisImg} /> : null}
            <View style={st.podpisLinka} />
            <Text style={st.podpisJmeno}>{SKOLA.reditel}</Text>
            <Text style={st.podpisFunkce}>ředitel školy (nebo pověřená osoba)</Text>
          </View>
        </View>

        {d.overeni ? (
          <View style={st.overeni} wrap={false}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image nemá alt */}
            <Image src={d.overeni.qr} style={st.qr} />
            <View style={{ flex: 1 }}>
              <Text style={st.overeniNadpis}>Ověření pravosti</Text>
              <Text style={st.overeniText}>
                Naskenujte QR kód, nebo otevřete {d.overeni.url.replace(/\/[^/]*$/, '')} a zadejte kód:
              </Text>
              <Text style={st.overeniKod}>{d.overeni.kod}</Text>
              <Text style={st.overeniText}>
                Potvrzení je platné do {fmtDate(d.overeni.plati_do)}. Ověřovací stránka ukáže údaje,
                které škola skutečně vydala.
              </Text>
            </View>
          </View>
        ) : null}

        <Text style={st.pozn}>
          {d.podpis || d.razitko
            ? 'Podpis a razítko jsou vloženy elektronicky při vydání z informačního systému školy; pravost ověříte výše uvedeným kódem.'
            : 'Potvrzení je platné s vlastnoručním podpisem oprávněné osoby a otiskem razítka školy.'}
        </Text>

        <BrandFooter />
      </Page>
    </Document>
  )
}

export async function renderPotvrzeniPdf(data: PotvrzeniData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<PotvrzeniDoc d={data} />)
}
