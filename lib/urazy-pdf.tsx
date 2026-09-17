/**
 * lib/urazy-pdf.tsx
 *
 * PDF tiskopis „Záznam o úrazu" (@react-pdf/renderer). Server-only. Struktura
 * kopíruje číslovaná pole formuláře InspIS DATA 2026 (pole 1–29) + případné
 * aktualizace (pole 30–34). Slouží jako listinný výstup vedle knihy úrazů a jako
 * podklad, který uživatel v Fázi 1 ručně přepisuje do InspIS.
 *
 * Font Geist (OFL) sdílíme s katalogovým listem (lib/katalogovy-list/fonts) —
 * standardní PDF Helvetica neumí českou diakritiku. Jediný řez (Regular).
 *
 * PRD: Nilsson_documentation/daily_notes/PRD-urazy-2026-09-10.md
 */

import 'server-only'
import path from 'node:path'
import { Document, Page, View, Text, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'
import {
  ciselnikLabel,
  formatPoradove,
  zranenyCeleJmeno,
  CAST_TELA,
  PRICINA,
  DRUH_CINNOSTI,
  MISTO_URAZU,
  PREVENCE,
  ZPUSOB_VYROZUMENI,
  VEC_ZRANENI,
  type UrazZaznam,
  type UrazAktualizace,
} from './urazy'

let fontRegistered = false
function ensureFont() {
  if (fontRegistered) return
  Font.register({
    family: 'Geist',
    src: path.join(process.cwd(), 'lib', 'katalogovy-list', 'fonts', 'Geist-Regular.ttf'),
  })
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

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const anoNe = (v: string | null): string => (v === 'ano' ? 'ano' : v === 'ne' ? 'ne' : '—')
const boolText = (v: boolean | null | undefined): string => (v == null ? '—' : v ? 'ano' : 'ne')

function adresa(ulice: string | null, psc: string | null, obec: string | null): string {
  const parts = [ulice, [psc, obec].filter(Boolean).join(' ')].filter((p) => p && p.length > 0)
  return parts.length > 0 ? parts.join(', ') : '—'
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
  num: { width: 16, color: C.muted },
  label: { width: 170, color: C.muted },
  value: { flex: 1 },
  valueStrong: { flex: 1, color: C.text },

  muted: { color: C.muted },
  banner: { marginTop: 4, marginBottom: 2, padding: 5, backgroundColor: C.bgHead, fontSize: 8.5 },

  podpis: { marginTop: 24, alignItems: 'flex-end' },
  podpisLine: { marginTop: 28, borderTopWidth: 0.5, borderTopColor: C.lineStrong, paddingTop: 3, width: 220, alignItems: 'center' },
  footerBrand: { position: 'absolute', bottom: 20, left: 44, right: 44, fontSize: 7, color: C.muted, textAlign: 'center' },
  footerPage: { position: 'absolute', bottom: 32, left: 44, right: 44, fontSize: 7.5, color: C.muted, textAlign: 'right' },
})

function Radek({ num, label, value }: { num?: string; label: string; value: string | null }) {
  return (
    <View style={s.row}>
      <Text style={s.num}>{num ? `${num}.` : ''}</Text>
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

function ZaznamDocument({ z, aktualizace }: { z: UrazZaznam; aktualizace: UrazAktualizace[] }) {
  const jmeno = zranenyCeleJmeno(z)
  const cislo = formatPoradove(z.poradove_cislo, z.skolni_rok)
  const nadpis = z.je_zaznam ? 'Záznam o úrazu' : 'Zápis do knihy úrazů'

  return (
    <Document title={`${nadpis} — ${jmeno} (${cislo})`} author={SKOLA.nazev}>
      <Page size="A4" style={s.page}>
        {/* hlavička */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.schoolName}>{SKOLA.nazev}</Text>
            {SKOLA.adresa ? <Text style={s.schoolMeta}>{SKOLA.adresa}</Text> : null}
            <Text style={s.schoolMeta}>
              {[SKOLA.ico ? `IČO: ${SKOLA.ico}` : '', SKOLA.izo ? `IZO: ${SKOLA.izo}` : '', SKOLA.redIzo ? `RED-IZO: ${SKOLA.redIzo}` : '']
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <View>
            <Text style={s.docTitle}>{nadpis}</Text>
            <Text style={s.docSub}>č. {cislo}</Text>
          </View>
        </View>

        <Text style={s.muted}>
          Dle vyhlášky č. 64/2005 Sb., o evidenci úrazů dětí, žáků a studentů, ve znění pozdějších
          předpisů.
        </Text>

        {/* evidence */}
        <Sekce title="Evidence">
          <Radek num="1" label="Druh školy / školského zařízení (IZO)" value={z.druh_skoly_izo} />
          <Radek num="2" label="Pořadové číslo / školní rok" value={cislo} />
        </Sekce>

        {/* zraněný */}
        <Sekce title="Zraněný">
          <Radek num="3" label="Jméno a příjmení" value={jmeno} />
          <Radek num="4" label="Datum narození" value={fmtDate(z.zraneny_datum_narozeni)} />
          <Radek num="5" label="Ročník" value={z.zraneny_rocnik != null ? String(z.zraneny_rocnik) : null} />
          <Radek label="Třída" value={z.trida} />
          <Radek num="6–8" label="Trvalý pobyt" value={adresa(z.zraneny_ulice, z.zraneny_psc, z.zraneny_obec)} />
        </Sekce>

        {/* zákonný zástupce */}
        <Sekce title="Zákonný zástupce">
          <Radek num="9" label="Jméno a příjmení" value={z.zz_jmeno} />
          <Radek label="Jiná adresa než zraněný?" value={anoNe(z.zz_jina_adresa)} />
          <Radek num="10–12" label="Adresa" value={adresa(z.zz_ulice, z.zz_psc, z.zz_obec)} />
        </Sekce>

        {/* úraz a okolnosti */}
        <Sekce title="Úraz a okolnosti">
          <Radek num="13" label="Datum a čas úrazu" value={fmtDateTime(z.datum_cas)} />
          <Radek num="14" label="Zákonný zástupce vyrozuměn" value={anoNe(z.zz_vyrozumen)} />
          <Radek label="Způsob vyrozumění ZZ" value={ciselnikLabel(ZPUSOB_VYROZUMENI, z.zz_vyrozumen_zpusob) || null} />
          <Radek label="Datum a čas vyrozumění ZZ" value={z.zz_vyrozumen_datum_cas ? fmtDateTime(z.zz_vyrozumen_datum_cas) : null} />
          <Radek num="15" label="Byl úraz smrtelný?" value={z.smrtelny ? 'ano' : 'ne'} />
          <Radek label="Datum úmrtí" value={z.datum_umrti ? fmtDate(z.datum_umrti) : null} />
          <Radek num="16" label="Zdravotnické zařízení" value={z.zdravotnicke_zarizeni} />
          <Radek num="17" label="Popis události" value={z.popis_udalosti} />
          <Radek num="18" label="Zraněná část těla" value={ciselnikLabel(CAST_TELA, z.cast_tela) || null} />
          <Radek num="19" label="Předpokládaná příčina" value={ciselnikLabel(PRICINA, z.pricina) || null} />
          <Radek num="20" label="Druh činnosti" value={ciselnikLabel(DRUH_CINNOSTI, z.druh_cinnosti) || null} />
          <Radek num="21" label="Místo úrazu" value={ciselnikLabel(MISTO_URAZU, z.misto_urazu) || null} />
          <Radek num="22" label="Preventivní opatření školy" value={ciselnikLabel(PREVENCE, z.prevence) || null} />
          <Radek label="Věc, kterou bylo zranění způsobeno" value={ciselnikLabel(VEC_ZRANENI, z.vec_zraneni) || null} />
          <Radek num="23" label="Zavinění zraněného / jiné osoby" value={anoNe(z.zavineni)} />
          <Radek label="Způsobeno / ovlivněno jinou osobou?" value={anoNe(z.jina_osoba)} />
          <Radek label="Jméno jiné osoby" value={z.jina_osoba_jmeno} />
          <Radek label="Spolupůsobení přírodních živlů / zvířat?" value={anoNe(z.zivly_zvirata)} />
        </Sekce>

        {/* svědci a dohled */}
        <Sekce title="Svědci a dohled">
          <Radek num="24" label="Svědek úrazu" value={z.svedek1} />
          <Radek num="25" label="Datum sepsání záznamu" value={fmtDate(z.datum_sepsani)} />
          <Radek num="26" label="Osoba vykonávající dohled — jméno" value={z.dohled_jmeno} />
          <Radek num="27" label="Osoba vykonávající dohled — funkce" value={z.dohled_funkce} />
          <Radek num="28" label="Přímo nadřízený — jméno" value={z.dohled_nadrizeny_jmeno} />
          <Radek num="29" label="Přímo nadřízený — funkce" value={z.dohled_nadrizeny_funkce} />
        </Sekce>

        {/* aktualizace */}
        {aktualizace.length > 0 && (
          <Sekce title="Aktualizace záznamu (náhrada / úmrtí)">
            {aktualizace.map((a, n) => (
              <View key={a.id} style={{ marginBottom: 6 }} wrap={false}>
                <Text style={s.muted}>Aktualizace {n + 1} — sepsáno {fmtDate(a.datum_sepsani)}</Text>
                <Radek num="31" label="Náhrada za bolest vyplacena" value={boolText(a.nahrada_bolest)} />
                <Radek num="32" label="Náhrada za ZSU vyplacena" value={boolText(a.nahrada_zsu)} />
                <Radek num="33" label="Úmrtí v důsledku úrazu" value={boolText(a.smrtelny)} />
                <Radek label="Datum úmrtí" value={a.datum_umrti ? fmtDate(a.datum_umrti) : null} />
                <Radek num="34" label="Přímo nadřízený" value={[a.dohled_nadrizeny_jmeno, a.dohled_nadrizeny_funkce].filter(Boolean).join(' · ') || null} />
              </View>
            ))}
          </Sekce>
        )}

        {/* poznámka o povinnosti záznamu */}
        {!z.je_zaznam && (
          <Text style={s.banner}>
            U tohoto úrazu nevznikla povinnost vyhotovit záznam o úrazu (§ 2 vyhlášky) — slouží jako
            zápis do knihy úrazů.
          </Text>
        )}

        {/* podpis */}
        <View style={s.podpis} wrap={false}>
          <Text style={s.muted}>V Teplicích dne {fmtDate(z.datum_sepsani ?? new Date().toISOString())}</Text>
          <View style={s.podpisLine}>
            <Text>{SKOLA.reditel}</Text>
            <Text style={s.muted}>ředitel školy</Text>
          </View>
        </View>

        <Text style={s.footerPage} fixed>
          {jmeno} · č. {cislo}
        </Text>
        <Text style={s.footerBrand} fixed>
          Nilsson · školní informační systém pro alternativní školy · nilsson.cz
        </Text>
      </Page>
    </Document>
  )
}

export async function renderUrazZaznamPdf(
  z: UrazZaznam,
  aktualizace: UrazAktualizace[] = [],
): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<ZaznamDocument z={z} aktualizace={aktualizace} />)
}
