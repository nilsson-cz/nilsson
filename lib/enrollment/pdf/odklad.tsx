/**
 * lib/enrollment/pdf/odklad.tsx
 *
 * Formální správní akty k odkladu povinné školní docházky:
 *  - renderPreruseniUsneseniPdf … „Usnesení o přerušení řízení" (§ 64 odst. 1
 *    písm. c) správního řádu) — když k žádosti o odklad chybí posudky PPP/lékaře.
 *    Vzniká PŘED rozhodnutím; text je boilerplate + pár proměnných.
 *  - renderOdkladRozhodnutiPdf … „Rozhodnutí o odkladu PŠD" (§ 37 odst. 1
 *    školského zákona) — hlavička/výrok/poučení z dat, odůvodnění píše ředitel.
 *
 * Znění 1:1 podle vzorů dodaných školou (2026). Adresát = zákonný zástupce.
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
  ODVOLACI,
  SKOLA,
} from './layout'

// Společná identifikace účastníků a spisu.
export interface OdkladZaklad {
  // zákonný zástupce (žadatel / adresát)
  zz_jmeno: string
  zz_adresa_radky: string[] // víceřádková adresa ZZ
  // dítě
  dite_jmeno: string
  dite_narozeni: string | null // ISO nebo už zformátované — formátujeme fmtDate
  dite_rodne_cislo: string | null
  dite_adresa: string
  // eSSL
  cislo_jednaci: string | null
  datum_vydani: string | null // = datum rozhodnutí (deterministicky)
}

// Rozdělí víceřádkový volný text na odstavce (prázdný řádek = nový odstavec).
function odstavce(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter((p) => p.length > 0)
}

function radky(text: string): string[] {
  return text
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
}

// ── I. Usnesení o přerušení řízení ───────────────────────────────────────

export interface PreruseniData extends OdkladZaklad {
  datum_zadosti: string | null // kdy byla žádost doručena škole
  lhuta_dnu: number // lhůta k doplnění (default 30)
}

function PreruseniDocument({ d }: { d: PreruseniData }) {
  const diteNar = fmtDate(d.dite_narozeni)
  const lhuta = d.lhuta_dnu > 0 ? d.lhuta_dnu : 30

  return (
    <FormalPage title={`Usnesení o přerušení řízení — ${d.dite_jmeno}`}>
      <FormalniHlavicka
        adresatRadky={[d.zz_jmeno, ...d.zz_adresa_radky]}
        cisloJednaci={d.cislo_jednaci}
        datumVydani={d.datum_vydani}
      />

      <View style={sf.divider} />
      <Text style={sf.docTitle}>USNESENÍ</Text>
      <Text style={sf.docSub}>o přerušení řízení</Text>

      <Text style={[sf.odstavec, { marginTop: 10 }]}>
        {SKOLA.nazev}, jako věcně a místně příslušný správní orgán podle § 165 odst. 2 písm. b)
        zákona č. 561/2004 Sb., o předškolním, základním, středním, vyšším odborném a jiném vzdělávání
        (školský zákon), ve znění pozdějších předpisů, rozhoduje v souladu s § 64 odst. 1 písm. c)
        zákona č. 500/2004 Sb., správní řád, ve znění pozdějších předpisů, takto:
      </Text>

      <Text style={sf.sekceNadpis}>I. Řízení se přerušuje.</Text>
      <Text style={sf.odstavec}>
        Řízení o žádosti zákonného zástupce {d.zz_jmeno} o odklad povinné školní docházky žáka{' '}
        {d.dite_jmeno}, narozeného {diteNar}, se přerušuje ode dne vydání tohoto usnesení do doby
        doplnění níže uvedených podkladů.
      </Text>

      <Text style={sf.sekceNadpis}>II. Zákonný zástupce se vyzývá k doplnění žádosti.</Text>
      <Text style={sf.odstavec}>
        Zákonný zástupce je povinen ve lhůtě {lhuta} dnů ode dne doručení tohoto usnesení doložit
        žádost o odklad povinné školní docházky o tyto podklady:
      </Text>
      <View style={sf.odrazka}>
        <Text style={sf.odrazkaBod}>1.</Text>
        <Text style={sf.odrazkaText}>
          Doporučující posouzení příslušného školského poradenského zařízení (pedagogicko-psychologická
          poradna nebo speciálně pedagogické centrum) — § 37 odst. 1 školského zákona,
        </Text>
      </View>
      <View style={sf.odrazka}>
        <Text style={sf.odrazkaBod}>2.</Text>
        <Text style={sf.odrazkaText}>
          Doporučující posouzení odborného lékaře nebo klinického psychologa — § 37 odst. 1 školského
          zákona.
        </Text>
      </View>
      <Text style={[sf.odstavec, { marginTop: 6 }]}>
        Oba podklady musí být v originále nebo ověřené kopii a musí se vztahovat k osobě výše uvedeného
        dítěte.
      </Text>
      <Text style={sf.odstavec}>Podklady je možné doručit:</Text>
      {['osobně do sídla školy,', 'poštou na adresu školy,', 'datovou schránkou.'].map((r) => (
        <View key={r} style={sf.odrazka}>
          <Text style={sf.odrazkaBod}>•</Text>
          <Text style={sf.odrazkaText}>{r}</Text>
        </View>
      ))}

      <Text style={sf.sekceNadpis}>Odůvodnění</Text>
      <Text style={sf.odstavec}>
        Dne {fmtDate(d.datum_zadosti)} byla prostřednictvím datové schránky doručena škole žádost
        zákonného zástupce {d.zz_jmeno} o odklad povinné školní docházky žáka {d.dite_jmeno}. Tímto
        dnem bylo zahájeno správní řízení ve věci odkladu povinné školní docházky (§ 44 odst. 1
        správního řádu).
      </Text>
      <Text style={sf.odstavec}>
        Podle § 37 odst. 1 školského zákona je podmínkou pro povolení odkladu začátku povinné školní
        docházky vedle žádosti zákonného zástupce rovněž doporučující posouzení příslušného školského
        poradenského zařízení a doporučující posouzení odborného lékaře nebo klinického psychologa.
        Tato posouzení jsou zákonnými podmínkami pro vydání rozhodnutí o odkladu; bez nich nelze
        žádosti vyhovět.
      </Text>
      <Text style={sf.odstavec}>
        Předložená žádost tyto zákonem požadované podklady neobsahovala, a jde tedy o vadu podání ve
        smyslu § 45 odst. 2 správního řádu.
      </Text>
      <Text style={sf.odstavec}>
        Správní orgán proto v souladu s § 64 odst. 1 písm. c) správního řádu řízení přerušil a vyzval
        zákonného zástupce k odstranění vad žádosti ve stanovené lhůtě. Po dobu přerušení řízení neběží
        lhůta pro vydání rozhodnutí (§ 64 odst. 4 správního řádu).
      </Text>

      <Text style={sf.sekceNadpis}>Poučení</Text>
      <Text style={sf.odstavec}>
        Proti tomuto usnesení lze podat odvolání do 15 dnů ode dne jeho doručení ke{' '}
        {ODVOLACI.nazevDativ} prostřednictvím {SKOLA.nazevGenitiv}.
      </Text>
      <Text style={sf.odstavec}>
        Nebude-li žádost doplněna ve stanovené lhůtě, správní orgán řízení zastaví podle § 66 odst. 1
        písm. c) správního řádu.
      </Text>

      <PodpisFormal datum={d.datum_vydani} />

      <Text style={[sf.metaRadek, { marginTop: 18, color: '#6b7280' }]}>
        Doručuje se: zákonný zástupce {d.zz_jmeno} — datovou schránkou
      </Text>
    </FormalPage>
  )
}

export async function renderPreruseniUsneseniPdf(d: PreruseniData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<PreruseniDocument d={d} />)
}

// ── II. Rozhodnutí o odkladu PŠD ─────────────────────────────────────────

export interface OdkladRozhodnutiData extends OdkladZaklad {
  zz_adresa_pobyt: string // jednořádkově pro sekci Účastník řízení
  cilovy_skolni_rok: string // „2027/2028"
  datum_nastupu_text: string // „1. září 2027"
  oduvodneni: string // volný text ředitele (může být víceodstavcový)
  prilohy: string // volný text, jedna položka na řádek (nepovinné)
  skartacni_znak: string // default „S-10 (uchování po dobu 10 let)"
}

function OdkladRozhodnutiDocument({ d }: { d: OdkladRozhodnutiData }) {
  const diteNar = fmtDate(d.dite_narozeni)
  const oduvodneniOdst = odstavce(d.oduvodneni)
  const prilohyRadky = radky(d.prilohy)

  return (
    <FormalPage title={`Rozhodnutí o odkladu PŠD — ${d.dite_jmeno}`}>
      <FormalniHlavicka
        adresatRadky={[d.zz_jmeno, ...d.zz_adresa_radky]}
        cisloJednaci={d.cislo_jednaci}
        datumVydani={d.datum_vydani}
      />

      <View style={sf.divider} />
      <Text style={sf.docTitle}>ROZHODNUTÍ</Text>
      <Text style={sf.docSub}>o odkladu povinné školní docházky</Text>

      <Text style={sf.sekceNadpis}>Účastník řízení</Text>
      <Text style={sf.odstavec}>
        Zákonný zástupce: {d.zz_jmeno}, adresa trvalého pobytu: {d.zz_adresa_pobyt}
        {'\n'}Dítě: {d.dite_jmeno}, nar. {diteNar}, rodné číslo: {d.dite_rodne_cislo ?? '—'}, adresa
        trvalého pobytu: {d.dite_adresa}
      </Text>

      <Text style={sf.sekceNadpis}>Výrok</Text>
      <Text style={sf.odstavec}>
        Podle § 37 odst. 1 zákona č. 561/2004 Sb., o předškolním, základním, středním, vyšším odborném
        a jiném vzdělávání (školský zákon), ve znění pozdějších předpisů,
      </Text>
      <Text style={sf.vyrok}>se odkládá</Text>
      <Text style={sf.odstavec}>
        začátek povinné školní docházky dítěte {d.dite_jmeno}, nar. {diteNar}, o jeden školní rok, a to
        na školní rok {d.cilovy_skolni_rok}.
      </Text>
      <Text style={sf.odstavec}>
        Dítě zahájí povinnou školní docházku počátkem školního roku {d.cilovy_skolni_rok}, tedy dne{' '}
        {d.datum_nastupu_text}.
      </Text>

      <Text style={sf.sekceNadpis}>Odůvodnění</Text>
      {oduvodneniOdst.length > 0 ? (
        oduvodneniOdst.map((p, i) => (
          <Text key={i} style={sf.odstavec}>
            {p}
          </Text>
        ))
      ) : (
        <Text style={[sf.odstavec, { color: '#92400e' }]}>[Doplňte odůvodnění.]</Text>
      )}

      <Text style={sf.sekceNadpis}>Poučení</Text>
      <Text style={sf.odstavec}>
        Proti tomuto rozhodnutí lze podat odvolání ve lhůtě 15 dnů ode dne jeho doručení. Odvolání se
        podává u ředitele {SKOLA.nazevGenitiv}, který je předá spolu se spisovým materiálem{' '}
        {ODVOLACI.nazevDativ}, {ODVOLACI.adresa}, který o odvolání rozhodne.
      </Text>
      <Text style={sf.odstavec}>
        Odvolání lze podat písemně nebo ústně do protokolu, a to u ředitele školy, případně u{' '}
        {ODVOLACI.nazevGenitiv}.
      </Text>
      <Text style={sf.odstavec}>
        Toto rozhodnutí nabývá právní moci dnem, kdy uplyne lhůta k podání odvolání, aniž by bylo
        odvolání podáno, nebo dnem, kdy zákonný zástupce vezme podané odvolání zpět, případně dnem
        doručení rozhodnutí o odvolání, jímž se rozhodnutí potvrzuje.
      </Text>

      <PodpisFormal datum={d.datum_vydani} />

      {prilohyRadky.length > 0 && (
        <View wrap={false}>
          <Text style={sf.sekceNadpis}>Přílohy správního spisu</Text>
          {prilohyRadky.map((r, i) => (
            <View key={i} style={sf.odrazka}>
              <Text style={sf.odrazkaBod}>•</Text>
              <Text style={sf.odrazkaText}>{r}</Text>
            </View>
          ))}
        </View>
      )}

      {d.skartacni_znak.trim() ? (
        <Text style={[sf.metaRadek, { marginTop: 12, color: '#6b7280' }]}>
          Skartační znak: {d.skartacni_znak}
        </Text>
      ) : null}
    </FormalPage>
  )
}

export async function renderOdkladRozhodnutiPdf(d: OdkladRozhodnutiData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<OdkladRozhodnutiDocument d={d} />)
}
