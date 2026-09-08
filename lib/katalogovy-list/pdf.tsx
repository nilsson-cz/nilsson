// lib/katalogovy-list/pdf.tsx
// PDF katalogového listu žáka (@react-pdf/renderer). Server-only.
// Font Geist (OFL) přibalen v ./fonts kvůli české diakritice — standardní
// PDF Helvetica ji neumí. Používá se jediný řez (Regular); zvýraznění = velikost,
// barva a linky, ne tučné písmo (bold řez nepřibalujeme).

import 'server-only'
import path from 'node:path'
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Font,
  renderToBuffer,
} from '@react-pdf/renderer'
import { znamkaText } from './znamka'
import type { KatalogovyListData, KLKompetence } from './types'

// --- registrace fontu (jednorázově) ---
let fontRegistered = false
function ensureFont() {
  if (fontRegistered) return
  Font.register({
    family: 'Geist',
    src: path.join(process.cwd(), 'lib', 'katalogovy-list', 'fonts', 'Geist-Regular.ttf'),
  })
  // Vypnout přetékání pomlčkováním (react-pdf jinak láme česká slova podivně).
  Font.registerHyphenationCallback((word) => [word])
  fontRegistered = true
}

const SKOLA = {
  nazev: process.env.SCHOOL_NAME ?? 'Základní škola Vilekula Teplice',
  adresa: process.env.SCHOOL_ADDRESS ?? 'J. V. Sládka 1548/22, 415 01 Teplice',
  izo: process.env.MSMT_IZO ?? '',
  ico: process.env.SCHOOL_ICO ?? '23136316',
  redIzo: process.env.SCHOOL_RED_IZO ?? '691018901',
  reditel: process.env.SCHOOL_DIRECTOR ?? 'Ing. Jakub Mráček',
}

const STUPEN_LABEL: Record<string, string> = {
  s_jistotou: 'zvládá s jistotou',
  castecne: 'zvládá částečně',
  s_dopomoci: 'zvládá s dopomocí',
  nezvlada: 'nezvládá',
  nezacali: 'nezačal(a)',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function stupenText(s: KLKompetence['stupen']): string {
  return s ? STUPEN_LABEL[s] ?? s : 'bez záznamu'
}

const C = {
  text: '#1a1a1a',
  muted: '#6b7280',
  line: '#d1d5db',
  lineStrong: '#374151',
  bgHead: '#f3f4f6',
}

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 48, paddingHorizontal: 44, fontFamily: 'Geist', fontSize: 9, color: C.text, lineHeight: 1.4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: C.lineStrong, paddingBottom: 6, marginBottom: 14 },
  schoolName: { fontSize: 11, color: C.text },
  schoolMeta: { fontSize: 8, color: C.muted },
  docTitle: { fontSize: 15, textAlign: 'right', marginBottom: 3 },
  docSub: { fontSize: 8, color: C.muted, textAlign: 'right' },

  sectionTitle: { fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 4, borderBottomWidth: 0.5, borderBottomColor: C.line, paddingBottom: 2 },

  row: { flexDirection: 'row', marginBottom: 2, alignItems: 'flex-start' },
  label: { width: 150, color: C.muted },
  value: { flex: 1 },

  // tabulky
  tHead: { flexDirection: 'row', backgroundColor: C.bgHead, paddingVertical: 3, paddingHorizontal: 4, marginTop: 4 },
  tRow: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: C.line },
  tCellHead: { color: C.muted, fontSize: 8 },

  compSubject: { marginTop: 8, marginBottom: 2, fontSize: 9, color: C.lineStrong },
  compHead: { flexDirection: 'row', paddingLeft: 6, paddingBottom: 2, borderBottomWidth: 0.5, borderBottomColor: C.line, marginBottom: 2 },
  compRow: { flexDirection: 'row', marginBottom: 2, paddingLeft: 6, alignItems: 'flex-start' },
  compTextCol: { flex: 1, paddingRight: 10 },
  compStupenCol: { width: 96 },

  muted: { color: C.muted },
  podpis: { marginTop: 24, alignItems: 'flex-end' },
  podpisLine: { marginTop: 28, borderTopWidth: 0.5, borderTopColor: C.lineStrong, paddingTop: 3, width: 200, alignItems: 'center' },
  footerSvp: { position: 'absolute', bottom: 32, left: 44, right: 210, fontSize: 7.5, color: C.muted },
  footerPage: { position: 'absolute', bottom: 32, left: 210, right: 44, fontSize: 7.5, color: C.muted, textAlign: 'right' },
  footerBrand: { position: 'absolute', bottom: 20, left: 44, right: 44, fontSize: 7, color: C.muted, textAlign: 'center' },
})

function Radek({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <View style={s.value}>
        <Text>{value && value.trim() ? value : '—'}</Text>
      </View>
    </View>
  )
}

function Sekce({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View wrap={false}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function KatalogovyListDocument({ data }: { data: KatalogovyListData }) {
  const i = data.identifikace
  const jmeno = `${i.jmeno} ${i.prijmeni}`.trim()

  return (
    <Document title={`Katalogový list — ${jmeno}`} author={SKOLA.nazev}>
      <Page size="A4" style={s.page}>
        {/* hlavička */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.schoolName}>{SKOLA.nazev}</Text>
            {SKOLA.adresa ? <Text style={s.schoolMeta}>{SKOLA.adresa}</Text> : null}
            <Text style={s.schoolMeta}>
              {[SKOLA.ico ? `IČO: ${SKOLA.ico}` : '', SKOLA.izo ? `IZO: ${SKOLA.izo}` : '', SKOLA.redIzo ? `RED-IZO: ${SKOLA.redIzo}` : ''].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View>
            <Text style={s.docTitle}>Katalogový list žáka</Text>
            <Text style={s.docSub}>vytvořeno {fmtDate(data.vytvorenoDne)}</Text>
          </View>
        </View>

        {/* identifikace */}
        <Sekce title="Identifikace žáka">
          <Radek label="Jméno a příjmení" value={jmeno} />
          <Radek label="Katalogové číslo" value={i.kodZaka} />
          <Radek label="Rodné číslo" value={i.rodneCislo} />
          <Radek label="Datum narození" value={fmtDate(i.datumNarozeni)} />
          <Radek label="Místo narození" value={i.mistoNarozeni} />
          <Radek label="Státní příslušnost" value={i.statniPrislusnost} />
          <Radek label="Třída / školní rok" value={[i.trida, i.skolniRok].filter(Boolean).join(' · ') || null} />
        </Sekce>

        {/* docházka do školy */}
        <Sekce title="Vzdělávání v naší škole">
          <Radek label="Veden(a) od" value={fmtDate(data.dochazkaSkola.vedenOd)} />
          <Radek label="Veden(a) do" value={data.dochazkaSkola.vedenDo ? fmtDate(data.dochazkaSkola.vedenDo) : 'dosud'} />
          <Radek label="Splněných let PŠD" value={data.dochazkaSkola.pocetLetPsd != null ? String(data.dochazkaSkola.pocetLetPsd) : null} />
          <Radek label="Způsob plnění PŠD" value={data.dochazkaSkola.zpusobPsd} />
          <Radek label="Vyučovací jazyk" value={data.vyucovaciJazyk} />
        </Sekce>

        {/* adresa */}
        <Sekce title="Adresa">
          <Radek label="Trvalé bydliště" value={data.adresa.trvale} />
          <Radek label="Korespondenční adresa" value={data.adresa.korespondencni} />
        </Sekce>

        {/* zákonní zástupci */}
        <Sekce title="Zákonní zástupci">
          {data.zastupci.length === 0 ? (
            <Text style={s.muted}>—</Text>
          ) : (
            data.zastupci.map((z, n) => (
              <View key={n} style={{ marginBottom: 4 }}>
                <Text>{z.jmeno} <Text style={s.muted}>({z.vztah})</Text></Text>
                <Text style={s.muted}>
                  {[z.bydliste, z.telefon, z.email].filter(Boolean).join(' · ') || '—'}
                </Text>
              </View>
            ))
          )}
        </Sekce>

        {/* předchozí vzdělávání */}
        <Sekce title="Předchozí vzdělávání">
          {data.predchoziVzdelavani.skoly.length === 0 && !data.predchoziVzdelavani.poznamka ? (
            <Text style={s.muted}>—</Text>
          ) : (
            <>
              {data.predchoziVzdelavani.skoly.map((sk, n) => (
                <Text key={n}>
                  {sk.nazev}
                  {sk.izo ? ` (IZO ${sk.izo})` : ''}
                  {sk.obdobiOd || sk.obdobiDo ? ` — ${fmtDate(sk.obdobiOd)}–${sk.obdobiDo ? fmtDate(sk.obdobiDo) : 'dosud'}` : ''}
                </Text>
              ))}
              {data.predchoziVzdelavani.poznamka ? <Text style={s.muted}>{data.predchoziVzdelavani.poznamka}</Text> : null}
            </>
          )}
        </Sekce>

        {/* podpůrná opatření */}
        <Sekce title="Podpůrná opatření / SVP">
          <Radek label="Speciální vzděl. potřeby" value={data.podpurnaOpatreni.maSvp ? 'ano' : 'ne'} />
          {data.podpurnaOpatreni.detail ? <Radek label="Detail" value={data.podpurnaOpatreni.detail} /> : null}
          {data.podpurnaOpatreni.pece.map((p, n) => (
            <Radek key={n} label={n === 0 ? 'Opatření' : ''} value={`${p.typ}${p.ivp ? ' · IVP' : ''}`} />
          ))}
        </Sekce>

        {/* zdraví */}
        <Sekce title="Zdravotní způsobilost">
          <Text style={data.zdravotniZpusobilost ? undefined : s.muted}>
            {data.zdravotniZpusobilost || 'bez záznamu v matrice'}
          </Text>
        </Sekce>

        {/* prospěch — známky */}
        <View>
          <Text style={s.sectionTitle}>
            Výsledky vzdělávání — klasifikace{data.prospech ? ` (${data.prospech.rok})` : ''}
          </Text>
          {!data.prospech ? (
            <Text style={s.muted}>Za poslední uzavřený školní rok nejsou k dispozici žádná hodnocení.</Text>
          ) : (
            <>
              <View style={s.tHead}>
                <Text style={[s.tCellHead, { flex: 1 }]}>Předmět</Text>
                <Text style={[s.tCellHead, { width: 120 }]}>1. pololetí</Text>
                <Text style={[s.tCellHead, { width: 120 }]}>2. pololetí</Text>
              </View>
              {data.prospech.predmety.map((p, n) => (
                <View key={n} style={s.tRow}>
                  <Text style={{ flex: 1 }}>{p.predmet}</Text>
                  <Text style={{ width: 120 }}>{znamkaText(p.znamkaP1)}</Text>
                  <Text style={{ width: 120 }}>{znamkaText(p.znamkaP2)}</Text>
                </View>
              ))}
              <Text style={[s.muted, { marginTop: 3, fontSize: 7.5 }]}>
                Známky jsou převedeny ze slovního hodnocení (Mapa růstu) podle pravidel ŠVP.
              </Text>
            </>
          )}
        </View>

        {/* prospěch — kompetence */}
        {data.prospech ? (
          <View break>
            <Text style={s.sectionTitle}>Výsledky vzdělávání — kompetence ({data.prospech.rok})</Text>
            <View style={s.compHead}>
              <Text style={[s.tCellHead, s.compTextCol]}>Kompetence</Text>
              <Text style={[s.tCellHead, s.compStupenCol]}>1. pololetí</Text>
              <Text style={[s.tCellHead, s.compStupenCol]}>2. pololetí</Text>
            </View>
            {data.prospech.predmety.map((p, n) => (
              <View key={n}>
                <Text style={s.compSubject} wrap={false}>{p.predmet}</Text>
                {p.kompetenceP1.length === 0 && p.kompetenceP2.length === 0 ? (
                  <Text style={[s.muted, { paddingLeft: 6 }]}>bez záznamu</Text>
                ) : (
                  (p.kompetenceP1.length ? p.kompetenceP1 : p.kompetenceP2).map((k, m) => {
                    const p2 = p.kompetenceP2[m]
                    return (
                      <View key={m} style={s.compRow} wrap={false}>
                        <View style={s.compTextCol}>
                          <Text>{k.text}</Text>
                        </View>
                        <View style={s.compStupenCol}>
                          <Text style={s.muted}>{stupenText(k.stupen)}</Text>
                        </View>
                        <View style={s.compStupenCol}>
                          <Text style={s.muted}>{stupenText(p2 ? p2.stupen : null)}</Text>
                        </View>
                      </View>
                    )
                  })
                )}
              </View>
            ))}
          </View>
        ) : null}

        {/* výchovná opatření */}
        <Sekce title="Výchovná opatření">
          {data.vychovnaOpatreni.length === 0 ? (
            <Text style={s.muted}>žádná</Text>
          ) : (
            data.vychovnaOpatreni.map((v, n) => (
              <Text key={n}>{fmtDate(v.datum)} — {v.typ}: <Text style={s.muted}>{v.zduvodneni}</Text></Text>
            ))
          )}
        </Sekce>

        {/* docházka souhrn */}
        <Sekce title="Docházka — souhrn">
          {!data.dochazkaSouhrn ? (
            <Text style={s.muted}>—</Text>
          ) : (
            <>
              <Radek label="1. pololetí (om. / neom.)" value={data.dochazkaSouhrn.p1 ? `${data.dochazkaSouhrn.p1.oml} / ${data.dochazkaSouhrn.p1.neoml} h` : '—'} />
              <Radek label="2. pololetí (om. / neom.)" value={data.dochazkaSouhrn.p2 ? `${data.dochazkaSouhrn.p2.oml} / ${data.dochazkaSouhrn.p2.neoml} h` : '—'} />
            </>
          )}
        </Sekce>

        {/* podpis */}
        <View style={s.podpis} wrap={false}>
          <Text style={s.muted}>
            V Teplicích dne {fmtDate(data.vytvorenoDne)}
          </Text>
          <View style={s.podpisLine}>
            <Text>{SKOLA.reditel}</Text>
            <Text style={s.muted}>ředitel školy</Text>
          </View>
        </View>

        {/* patička (samostatné fixed Texty — fixed View se nerenderuje) */}
        {data.posledniSvp ? (
          <Text style={s.footerSvp} fixed>
            {`ŠVP: ${data.posledniSvp.nazev}${data.posledniSvp.cisloJednaci ? `, č. j. ${data.posledniSvp.cisloJednaci}` : ''}`}
          </Text>
        ) : null}
        <Text style={s.footerPage} fixed>{jmeno}</Text>
        <Text style={s.footerBrand} fixed>
          Nilsson · školní informační systém pro alternativní školy · nilsson.cz
        </Text>
      </Page>
    </Document>
  )
}

export async function renderKatalogovyListPdf(data: KatalogovyListData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<KatalogovyListDocument data={data} />)
}
