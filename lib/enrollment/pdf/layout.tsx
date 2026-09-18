/**
 * lib/enrollment/pdf/layout.tsx
 *
 * Sdílené stavební prvky pro PDF dokumenty přijímacího řízení
 * (@react-pdf/renderer). Server-only. Dopisový formát (hlavička školy →
 * název dokumentu → místo a datum → adresát → oslovení → tělo → podpis),
 * po vzoru lib/urazy-pdf.tsx a lib/katalogovy-list/pdf.tsx.
 *
 * Font Geist (OFL) sdílíme s katalogovým listem (lib/katalogovy-list/fonts) —
 * standardní PDF Helvetica neumí českou diakritiku. Přibalen jediný řez
 * (Regular); zvýraznění řešíme velikostí, barvou a linkami, ne tučným řezem
 * (shodně s ostatními PDF v projektu).
 */

import 'server-only'
import path from 'node:path'
import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer'

// --- registrace fontu (jednorázově) ---
let fontRegistered = false
export function ensureFont() {
  if (fontRegistered) return
  Font.register({
    family: 'Geist',
    src: path.join(process.cwd(), 'lib', 'katalogovy-list', 'fonts', 'Geist-Regular.ttf'),
  })
  // Vypnout přetékání pomlčkováním (react-pdf jinak láme česká slova podivně).
  Font.registerHyphenationCallback((word) => [word])
  fontRegistered = true
}

// --- údaje školy (hlavička odesílatele) ---
// Defaulty odpovídají aktuálnímu vzoru (2026). Přepínatelné přes env, ať se
// nemusí sahat do kódu při změně sídla / statutáře.
export const SKOLA = {
  nazev: process.env.SCHOOL_NAME ?? 'Základní škola Vilekula Teplice',
  nazevGenitiv: process.env.SCHOOL_NAME_GENITIV ?? 'Základní školy Vilekula Teplice',
  nazevLokal: process.env.SCHOOL_NAME_LOKAL ?? 'Základní škole Vilekula Teplice',
  nazevKratky: process.env.SCHOOL_NAME_SHORT ?? 'ZŠ Vilekula Teplice',
  adresa: process.env.SCHOOL_ADDRESS ?? 'J. V. Sládka 1548/22, 415 01 Teplice',
  ico: process.env.SCHOOL_ICO ?? '231 36 316',
  redIzo: process.env.SCHOOL_RED_IZO ?? '691 018 901',
  ds: process.env.SCHOOL_DS ?? 'rm35wuu',
  ucet: process.env.SCHOOL_BANK_ACCOUNT ?? '2303305396/2010, Fio banka, a.s.',
  web: process.env.SCHOOL_WEB ?? 'zsvilekula.cz | @vilekula.teplice',
  mesto: process.env.SCHOOL_CITY ?? 'Teplice',
  reditel: process.env.SCHOOL_DIRECTOR ?? 'Ing. Jakub Mráček',
}

// Odvolací (nadřízený) správní orgán — pro poučení o odvolání.
export const ODVOLACI = {
  nazev: process.env.SCHOOL_ODVOLACI_NAZEV ?? 'Krajský úřad Ústeckého kraje',
  nazevDativ: process.env.SCHOOL_ODVOLACI_DATIV ?? 'Krajskému úřadu Ústeckého kraje',
  nazevGenitiv: process.env.SCHOOL_ODVOLACI_GENITIV ?? 'Krajského úřadu Ústeckého kraje',
  adresa: process.env.SCHOOL_ODVOLACI_ADRESA ?? 'Velká Hradební 3118/48, 400 02 Ústí nad Labem',
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

// „V Teplicích 27. 3. 2026"
export function mistoDatum(iso: string | null | undefined): string {
  return `V ${SKOLA.mesto === 'Teplice' ? 'Teplicích' : SKOLA.mesto} ${fmtDate(iso)}`
}

// Adresa žáka do centrálního bloku: „ulice číslo, PSČ obec".
export function adresaZaka(
  ulice: string | null | undefined,
  cislo: string | null | undefined,
  psc: string | null | undefined,
  obec: string | null | undefined,
): string {
  const radek1 = [ulice, cislo].filter(Boolean).join(' ')
  const radek2 = [psc, obec].filter(Boolean).join(' ')
  return [radek1, radek2].filter((p) => p.length > 0).join(', ')
}

export const C = {
  text: '#1a1a1a',
  muted: '#6b7280',
  line: '#d1d5db',
  lineStrong: '#374151',
  bgHead: '#f3f4f6',
  warn: '#92400e',
  warnBg: '#fef3c7',
}

export const s = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontFamily: 'Geist',
    fontSize: 10.5,
    color: C.text,
    lineHeight: 1.5,
  },

  // hlavička odesílatele (vpravo nahoře)
  hlavicka: { alignItems: 'flex-end', marginBottom: 36 },
  hlavickaNazev: { fontSize: 11 },
  hlavickaRadek: { fontSize: 8.5, color: C.muted },

  // název dokumentu
  docTitle: { fontSize: 15, marginBottom: 2 },
  docTitleBlock: { marginBottom: 18 },

  // místo a datum (vpravo)
  mistoDatum: { fontSize: 10, textAlign: 'right', marginBottom: 18 },

  // adresát
  adresat: { marginBottom: 18 },
  adresatRadek: { fontSize: 10.5 },

  // tělo
  osloveni: { marginBottom: 10 },
  odstavec: { marginBottom: 10, textAlign: 'justify' },

  // centrální blok se žákem
  zakBlok: { marginVertical: 12, alignItems: 'center' },
  zakRadek: { fontSize: 11.5, textAlign: 'center' },

  // č.j. / spisová značka
  cjRadek: { fontSize: 9, color: C.muted, marginBottom: 14 },

  // podpis
  podpis: { marginTop: 42, alignItems: 'flex-end' },
  podpisJmeno: { fontSize: 10.5 },
  podpisFunkce: { fontSize: 10.5, color: C.muted },

  // upozornění (placeholder / poznámka)
  banner: {
    marginVertical: 12,
    padding: 8,
    backgroundColor: C.warnBg,
    color: C.warn,
    fontSize: 9.5,
  },

  footerBrand: {
    position: 'absolute',
    bottom: 24,
    left: 56,
    right: 56,
    fontSize: 7.5,
    color: C.muted,
    textAlign: 'center',
  },
})

// Hlavička odesílatele (škola) — vpravo nahoře, jako ve vzoru.
export function SkolniHlavicka() {
  return (
    <View style={s.hlavicka}>
      <Text style={s.hlavickaNazev}>{SKOLA.nazev}</Text>
      <Text style={s.hlavickaRadek}>{SKOLA.adresa}</Text>
      <Text style={s.hlavickaRadek}>IČ: {SKOLA.ico}</Text>
      {SKOLA.ds ? <Text style={s.hlavickaRadek}>Datová schránka: {SKOLA.ds}</Text> : null}
      {SKOLA.ucet ? <Text style={s.hlavickaRadek}>Bankovní účet: {SKOLA.ucet}</Text> : null}
      {SKOLA.web ? <Text style={s.hlavickaRadek}>{SKOLA.web}</Text> : null}
    </View>
  )
}

// Podpis ředitele (vpravo dole). Elektronicky/vlastnoručně doplní ředitel.
export function Podpis() {
  return (
    <View style={s.podpis} wrap={false}>
      <Text style={s.podpisJmeno}>{SKOLA.reditel}</Text>
      <Text style={s.podpisFunkce}>ředitel školy</Text>
    </View>
  )
}

export function BrandFooter() {
  return (
    <Text style={s.footerBrand} fixed>
      Nilsson · školní informační systém pro alternativní školy · nilsson.cz
    </Text>
  )
}

// ── Formální správní akt (rozhodnutí / usnesení) ─────────────────────────
// Odlišný layout od oznámení: hlavička školy vlevo, blok adresáta (zákonný
// zástupce), č.j./datum/vyřizuje, číslované sekce VÝROK / ODŮVODNĚNÍ / POUČENÍ.

export const sf = StyleSheet.create({
  hlavickaNazev: { fontSize: 11.5, marginBottom: 2 },
  hlavickaRadek: { fontSize: 9, color: C.muted },
  divider: { borderBottomWidth: 0.5, borderBottomColor: C.line, marginVertical: 12 },

  blokNadpis: { fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  adresatRadek: { fontSize: 10.5 },
  metaRadek: { fontSize: 9.5 },

  docTitle: { fontSize: 16, textAlign: 'center', marginTop: 4 },
  docSub: { fontSize: 11, textAlign: 'center', color: C.muted, marginBottom: 4 },

  sekceNadpis: { fontSize: 11, marginTop: 16, marginBottom: 5, letterSpacing: 0.5 },
  vyrok: { fontSize: 12, textAlign: 'center', marginVertical: 8 },
  odstavec: { marginBottom: 8, textAlign: 'justify' },
  odstavecStred: { marginBottom: 8, textAlign: 'center' },
  odrazka: { flexDirection: 'row', marginBottom: 3, paddingLeft: 6 },
  odrazkaBod: { width: 14 },
  odrazkaText: { flex: 1, textAlign: 'justify' },

  podpisFormal: { marginTop: 32 },
  podpisJmeno: { fontSize: 10.5 },
  podpisFunkce: { fontSize: 10.5, color: C.muted },
})

// Hlavička školy (vlevo) + adresát (zákonný zástupce) + č.j./datum/vyřizuje.
export function FormalniHlavicka({
  adresatRadky,
  cisloJednaci,
  datumVydani,
  vyrizuje,
}: {
  adresatRadky: string[]
  cisloJednaci: string | null
  datumVydani: string | null
  vyrizuje?: string
}) {
  return (
    <View>
      <View>
        <Text style={sf.hlavickaNazev}>{SKOLA.nazev}</Text>
        <Text style={sf.hlavickaRadek}>se sídlem: {SKOLA.adresa}</Text>
        <Text style={sf.hlavickaRadek}>IČO: {SKOLA.ico}   ·   RED IZO: {SKOLA.redIzo}</Text>
        <Text style={sf.hlavickaRadek}>Ředitel školy: {SKOLA.reditel}</Text>
      </View>

      <View style={sf.divider} />

      <View>
        <Text style={sf.blokNadpis}>Adresát</Text>
        {adresatRadky
          .filter((r) => r.trim())
          .map((r, i) => (
            <Text key={i} style={sf.adresatRadek}>
              {r}
            </Text>
          ))}
      </View>

      <View style={sf.divider} />

      <View>
        <Text style={sf.metaRadek}>Č. j.: {cisloJednaci ?? '—'}</Text>
        <Text style={sf.metaRadek}>Datum vydání: {fmtDate(datumVydani)}</Text>
        <Text style={sf.metaRadek}>Vyřizuje: {vyrizuje ?? SKOLA.reditel}</Text>
      </View>
    </View>
  )
}

// Podpis ředitele u formálního aktu (vlevo, s místem a datem).
export function PodpisFormal({ datum }: { datum: string | null }) {
  return (
    <View style={sf.podpisFormal} wrap={false}>
      <Text style={{ marginBottom: 18 }}>{mistoDatum(datum)}</Text>
      <Text style={sf.podpisJmeno}>{SKOLA.reditel}</Text>
      <Text style={sf.podpisFunkce}>ředitel školy</Text>
      <Text style={sf.podpisFunkce}>{SKOLA.nazev}</Text>
    </View>
  )
}

// Obálka A4 pro formální akt (bez horní hlavičky — tu skládá dokument sám).
export function FormalPage({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Document title={title} author={SKOLA.nazev}>
      <Page size="A4" style={s.page}>
        {children}
        <BrandFooter />
      </Page>
    </Document>
  )
}

// Obálka jedné A4 stránky s hlavičkou školy a patičkou.
export function DopisPage({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Document title={title} author={SKOLA.nazev}>
      <Page size="A4" style={s.page}>
        <SkolniHlavicka />
        {children}
        <BrandFooter />
      </Page>
    </Document>
  )
}
