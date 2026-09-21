/**
 * lib/studijni-smlouva/pdf.tsx
 *
 * PDF „Smlouva o poskytování základního vzdělání" (studijní smlouva) pro
 * přijatého žáka. Server-only, @react-pdf/renderer. Znění 1:1 podle vzoru školy
 * (2026). Údaje z matriky se předvyplní; co v IS není (datum narození rodičů,
 * datum podpisu, podpisy) → tečkovaná linka k ručnímu doplnění.
 *
 * Délka smlouvy = počet zbývajících ročníků (budoucí prvňák 9, jinak méně).
 * Font Geist sdílíme s katalogovým listem (česká diakritika).
 */

import 'server-only'
import path from 'node:path'
import { Document, Page, View, Text, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'

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
  ico: process.env.SCHOOL_ICO ?? '231 36 316',
  adresa: process.env.SCHOOL_ADDRESS ?? 'J. V. Sládka 1548/22, 415 01 Teplice',
  reditel: process.env.SCHOOL_DIRECTOR ?? 'Ing. Jakub Mráček',
  ucet: process.env.SCHOOL_BANK_ACCOUNT ?? '2303305396/2010, Fio banka, a.s.',
  mesto: process.env.SCHOOL_CITY ?? 'Teplice',
}

// Kód zdravotní pojišťovny → název (nejčastější). Fallback = samotný kód.
const POJISTOVNA: Record<string, string> = {
  '111': 'Všeobecná zdravotní pojišťovna ČR (111)',
  '201': 'Vojenská zdravotní pojišťovna ČR (201)',
  '205': 'Česká průmyslová zdravotní pojišťovna (205)',
  '207': 'Oborová zdravotní pojišťovna (207)',
  '209': 'Zaměstnanecká pojišťovna Škoda (209)',
  '211': 'Zdravotní pojišťovna ministerstva vnitra ČR (211)',
  '213': 'Revírní bratrská pokladna (213)',
}

export interface SmlouvaRodic {
  jmeno: string | null
  bydliste: string | null
  psc: string | null
  email: string | null
  telefon: string | null
}

export interface StudijniSmlouvaData {
  zak: {
    jmeno: string
    prijmeni: string
    rodne_cislo: string | null
    datum_narozeni: string | null
    misto_narozeni: string | null
    bydliste: string | null
    pojistovna_kod: string | null
  }
  otec: SmlouvaRodic | null
  matka: SmlouvaRodic | null
  pocet_rocniku: number
  od_skolniho_roku: string // „2026/2027"
  skolne_kc: number // 4400
}

const DOTS = '……………………………………'

function hodnota(v: string | null | undefined, dots = DOTS): string {
  return v && v.trim() ? v : dots
}

function fmtDate(iso: string | null): string {
  if (!iso) return DOTS
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DOTS
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function pojistovnaText(kod: string | null): string {
  if (!kod) return DOTS
  return POJISTOVNA[kod] ?? kod
}

// Číslovka slovem pro délku (1–9); jinak číslicí.
const CISLOVKA: Record<number, string> = {
  1: 'jeden',
  2: 'dva',
  3: 'tři',
  4: 'čtyři',
  5: 'pět',
  6: 'šest',
  7: 'sedm',
  8: 'osm',
  9: 'devět',
}
function rocnikySlovem(n: number): string {
  return CISLOVKA[n] ? `${CISLOVKA[n]} ${n === 1 ? 'ročník' : n >= 2 && n <= 4 ? 'ročníky' : 'ročníků'}` : `${n} ročníků`
}

const C = { text: '#1a1a1a', muted: '#6b7280', line: '#374151' }

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 48, paddingHorizontal: 50, fontFamily: 'Geist', fontSize: 9.5, color: C.text, lineHeight: 1.45 },
  skolaNazev: { fontSize: 11 },
  skolaRadek: { fontSize: 9.5 },
  spacerSm: { height: 6 },
  spacer: { height: 10 },
  aCentr: { textAlign: 'center', marginVertical: 6 },
  radek: { marginBottom: 3 },
  label: { color: C.muted },
  title: { fontSize: 13, textAlign: 'center', marginVertical: 10 },
  sekce: { fontSize: 10.5, marginTop: 12, marginBottom: 4 },
  odst: { marginBottom: 5, textAlign: 'justify' },
  odrazka: { flexDirection: 'row', marginBottom: 3, paddingLeft: 8 },
  odrBod: { width: 16, color: C.muted },
  odrText: { flex: 1, textAlign: 'justify' },
  poleRadek: { marginBottom: 4 },
  podpisy: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
  podpisSl: { width: '45%', alignItems: 'center' },
  podpisLine: { borderTopWidth: 0.5, borderTopColor: C.line, width: '100%', marginBottom: 3 },
  footer: { position: 'absolute', bottom: 20, left: 50, right: 50, fontSize: 7, color: C.muted, textAlign: 'center' },
})

function RodicBlok({ role, r }: { role: string; r: SmlouvaRodic | null }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={s.radek}>
        <Text>{role}: </Text>
        {hodnota(r?.jmeno)}
        <Text style={s.label}>{'     datum narození: '}</Text>
        {DOTS}
      </Text>
      <Text style={s.radek}>
        <Text style={s.label}>bydliště: </Text>
        {hodnota(r?.bydliste)}
        <Text style={s.label}>{'   PSČ '}</Text>
        {hodnota(r?.psc, '…………')}
      </Text>
      <Text style={s.radek}>
        <Text style={s.label}>email: </Text>
        {hodnota(r?.email)}
        <Text style={s.label}>{'   tel.: '}</Text>
        {hodnota(r?.telefon, '……………………')}
      </Text>
    </View>
  )
}

function Odrazka({ c, children }: { c: string; children: React.ReactNode }) {
  return (
    <View style={s.odrazka}>
      <Text style={s.odrBod}>{c}</Text>
      <Text style={s.odrText}>{children}</Text>
    </View>
  )
}

function SmlouvaDocument({ d }: { d: StudijniSmlouvaData }) {
  const zakJmeno = `${d.zak.jmeno} ${d.zak.prijmeni}`.trim()
  return (
    <Document title={`Studijní smlouva — ${zakJmeno}`} author={SKOLA.nazev}>
      <Page size="A4" style={s.page}>
        {/* strany */}
        <Text style={s.skolaNazev}>{SKOLA.nazev}</Text>
        <Text style={s.skolaRadek}>IČ: {SKOLA.ico}</Text>
        <Text style={s.skolaRadek}>se sídlem {SKOLA.adresa}</Text>
        <Text style={s.skolaRadek}>zastoupená ředitelem {SKOLA.reditel}</Text>
        <Text style={[s.skolaRadek, s.label]}>(dále jen „škola“)</Text>

        <Text style={s.aCentr}>a</Text>

        <RodicBlok role="otec" r={d.otec} />
        <RodicBlok role="matka" r={d.matka} />
        <Text style={[s.radek, s.label]}>(dále jen rodiče)</Text>

        <Text style={s.aCentr}>uzavírají tuto</Text>
        <Text style={s.title}>Smlouvu o poskytování základního vzdělání</Text>

        {/* I. */}
        <Text style={s.sekce}>I. Předmět smlouvy</Text>
        <Odrazka c="1.">
          Předmětem smlouvy je zajištění základního vzdělávání v {SKOLA.nazev} podle školského zákona,
          rámcového vzdělávacího programu Ministerstva školství, mládeže a tělovýchovy ČR a školního
          vzdělávacího programu (dále jen „výuka“) podle obecně platných předpisů, vnitřních předpisů
          školy a podmínek této smlouvy.
        </Odrazka>
        <Odrazka c="2.">Škola na základě této smlouvy poskytuje žákovi:</Odrazka>
        <View style={{ paddingLeft: 24, marginTop: 2 }}>
          <Text style={s.poleRadek}>
            <Text style={s.label}>jméno, příjmení: </Text>
            {hodnota(zakJmeno)}
          </Text>
          <Text style={s.poleRadek}>
            <Text style={s.label}>rodné číslo: </Text>
            {hodnota(d.zak.rodne_cislo)}
          </Text>
          <Text style={s.poleRadek}>
            <Text style={s.label}>datum a místo narození: </Text>
            {fmtDate(d.zak.datum_narozeni)}
            {d.zak.misto_narozeni ? `, ${d.zak.misto_narozeni}` : ''}
          </Text>
          <Text style={s.poleRadek}>
            <Text style={s.label}>bydliště: </Text>
            {hodnota(d.zak.bydliste)}
          </Text>
          <Text style={s.poleRadek}>
            <Text style={s.label}>zdravotní pojišťovna: </Text>
            {pojistovnaText(d.zak.pojistovna_kod)}
          </Text>
          <Text style={[s.poleRadek, s.label]}>(dále jen „žák“)</Text>
        </View>
        <Text style={[s.odst, { paddingLeft: 24, marginTop: 2 }]}>
          základní vzdělání v rozsahu 1. až 9. třídy základní školy v souladu s příslušnými ustanoveními
          zákona č. 561/2004 Sb. školský zákon, ve znění pozdějších předpisů a souvisejících právních
          předpisů.
        </Text>

        {/* II. */}
        <Text style={s.sekce}>II. Doba trvání smlouvy</Text>
        <Text style={s.odst}>
          Na základě dohody smluvních stran se tato smlouva uzavírá na dobu trvání docházky žáka, která
          činí {rocnikySlovem(d.pocet_rocniku)}, počínaje školním rokem {d.od_skolniho_roku}.
          Nenastupuje-li žák do první třídy základní školy, je tato smlouva uzavírána na dobu zbývajících
          let základní školní docházky.
        </Text>

        {/* III. */}
        <Text style={s.sekce}>III. Školné a úhrada nákladů spojených s výukou</Text>
        <Odrazka c="1.">
          Rodič se zavazuje hradit školné za výuku ve výši {d.skolne_kc} Kč měsíčně za každé dítě po dobu
          školního roku (září–červen).
        </Odrazka>
        <Odrazka c="2.">
          Školné nezahrnuje náklady na teplé obědy, svačiny či jiné stravování žáka, náklady na pobytové
          akce a náklady na dobrovolné kroužky. Tyto náklady se hradí zvlášť.
        </Odrazka>
        <Odrazka c="3.">
          Školné za příslušný školní rok je splatné buď měsíčně k 10. dni daného měsíce nebo ve dvou
          pololetních splátkách pro příslušný školní rok splatných vždy do 10. 9. na první pololetí
          školního roku a do 10. 1. na druhé pololetí školního roku, a to přímo ze smlouvy bez
          vystavování faktur.
        </Odrazka>
        <Odrazka c="4.">Platba se provádí bezhotovostní platbou na účet školy č. {SKOLA.ucet}</Odrazka>
        <Odrazka c="5.">
          Rodič je povinen platbu školného identifikovat variabilním symbolem, který byl žákovi přidělen
          a do zprávy pro příjemce uvést jméno dítěte.
        </Odrazka>
        <Odrazka c="6.">
          Škola je oprávněna vždy k 1. pololetí školního roku jednostranně zvýšit školné o částku
          rovnající se oficiálně vyhlášené míře inflace Českým statistickým úřadem ve statistické ročence
          ČR či zveřejněné na jeho internetových stránkách za uplynulý kalendářní rok.
        </Odrazka>
        <Odrazka c="7.">
          O výši školného na nový školní rok je škola povinna rodiče informovat nejpozději do 30. června
          příslušného kalendářního roku. Do doby, než bude zákonnému zástupci žáka školou oznámena nová
          výše školného, je rodič povinen hradit školné ve výši dle předchozího školního roku.
        </Odrazka>

        {/* IV. */}
        <Text style={s.sekce}>IV. Práva a povinnosti smluvních stran</Text>
        <Text style={s.odst}>1. Škola se zavazuje:</Text>
        <Odrazka c="1)">
          zajistit výuku žáka v souladu s koncepcí školy, platnými zákonnými ustanoveními, v rozsahu
          stanoveném školním vzdělávacím programem základní školy pro I. a II. stupeň,
        </Odrazka>
        <Odrazka c="2)">
          zajistit stravování žáka po dobu školního roku ve školní jídelně na náklady rodiče, jakož i
          ranní a odpolední družinu (pokud ji škola v tom roce provozuje) za provozní příspěvek od rodiče,
        </Odrazka>
        <Odrazka c="3)">
          informovat pravidelně rodiče o vzdělávání a výchově žáka, o koncepci školy a metodách výuky,
        </Odrazka>
        <Odrazka c="4)">
          pořádat minimálně dvakrát během příslušného školního roku třídní schůzky a informovat na nich
          rodiče žáka o jeho prospěchu i o dalších skutečnostech souvisejících s výukou a mimoškolními
          aktivitami,
        </Odrazka>
        <Odrazka c="5)">
          informovat rodiče o učebních plánech na každý školní rok, o potřebě zajistit školní a ostatní
          pomůcky pro žáky na příslušný školní rok,
        </Odrazka>
        <Odrazka c="6)">
          včas informovat rodiče a žáky o školou organizovaných letních a zimních pobytech a o nezbytném
          vybavení žáků na tyto pobyty,
        </Odrazka>
        <Odrazka c="7)">
          seznámit žáky a rodiče se školním řádem a dalšími obecně závaznými právními předpisy vztahujícími
          se k výuce žáka.
        </Odrazka>
        <Odrazka c="8)">
          učinit veškeré kroky potřebné k zajištění ochrany a bezpečnosti života a zdraví žáka po dobu, kdy
          škola vykonává nad žákem dohled, jakož i ochrany jeho práv a oprávněných zájmů,
        </Odrazka>
        <Odrazka c="9)">
          umožnit po předchozí dohodě s průvodci či ředitelem školy navštívit v přiměřeném rozsahu výuku v
          hodinách, pokud tím nebude narušen její průběh a nebudou tomu bránit jiné vážné důvody.
        </Odrazka>

        <Text style={[s.odst, { marginTop: 4 }]}>2. Rodič se zavazuje:</Text>
        <Odrazka c="1)">zajišťovat pravidelnou docházku žáka,</Odrazka>
        <Odrazka c="2)">spolupracovat se školou při řešení výchovných a vzdělávacích záležitostí,</Odrazka>
        <Odrazka c="3)">platit školné podle odst. III,</Odrazka>
        <Odrazka c="4)">informovat školu o zdravotním stavu žáka i o všech jeho změnách,</Odrazka>
        <Odrazka c="5)">
          dostavit se na výzvu školy k projednání otázek souvisejících s výukou žáka, s jeho chováním a
          přestupky proti školnímu řádu či obecně závazným právním předpisům,
        </Odrazka>
        <Odrazka c="6)">
          řádně a včas omluvit neúčast žáka na vyučování, a to nejpozději do 3 kalendářních dnů od počátku
          nepřítomnosti žáka,
        </Odrazka>
        <Odrazka c="7)">
          zajistit pro žáka školy školou stanovené školní pomůcky pro příslušný školní rok,
        </Odrazka>
        <Odrazka c="8)">
          umožnit zpracovávat a evidovat osobní údaje i osobní citlivé údaje včetně rodného čísla svého
          dítěte ve smyslu všech ustanovení zákona č. 101/2000 Sb. o ochraně osobních údajů v platném
          znění a zákona č. 133/2000 Sb. o evidenci obyvatel a rodných číslech v platném znění. Svůj
          souhlas poskytuje pro účely vedení povinné dokumentace školy podle zákona č. 561/2004 Sb.
          školského zákona v platném znění, vedení nezbytné zdravotní dokumentace a psychologických
          vyšetření, mimoškolní akce školy jako školní výlety, školy v přírodě a lyžařské kurzy, přijímací
          řízení na střední školy, úrazové pojištění žáků a pro jiné účely související s běžným chodem
          školy. Souhlas poskytuje na celé období školní docházky svého dítěte na této škole a na zákonem
          stanovenou dobu, po kterou se tato dokumentace na škole povinně archivuje. Škola, bez zákonem
          stanovených případů, nesmí tyto osobní a citlivé osobní údaje poskytnout dalším osobám a úřadům,
        </Odrazka>
        <Odrazka c="9)">
          porušuje-li žák opakovaně školní řád a narušuje výuku, souhlasí rodič s přeřazením žáka na
          kmenovou školu, popřípadě na jinou základní školu dle výběru rodiče.
        </Odrazka>

        {/* V. */}
        <Text style={s.sekce}>V. Zánik smlouvy</Text>
        <Text style={s.odst}>1. Tato smlouva zaniká:</Text>
        <Odrazka c="1)">písemnou dohodou,</Odrazka>
        <Odrazka c="2)">písemnou výpovědí,</Odrazka>
        <Odrazka c="3)">uplynutím doby stanovené v bodu II.,</Odrazka>
        <Odrazka c="4)">odstoupením od smlouvy.</Odrazka>
        <Text style={[s.odst, { marginTop: 4 }]}>2. Rodič může podat výpověď bez udání důvodu.</Text>
        <Text style={s.odst}>3. Škola může dát výpověď pouze z těchto důvodů:</Text>
        <Odrazka c="1)">prodlení úhrad plateb specifikovaných v bodu III. déle než tři měsíce po jejich splatnosti,</Odrazka>
        <Odrazka c="2)">opakované porušování školního řádu (viz odst. IV, bod 2 g),</Odrazka>
        <Odrazka c="3)">nedostatek finančních prostředků školy,</Odrazka>
        <Odrazka c="4)">nízký počet žáků ve třídě.</Odrazka>
        <Text style={[s.odst, { marginTop: 4 }]}>
          4. Výpovědní doba se sjednává v délce jednoho měsíce od podání výpovědi.
        </Text>

        {/* VI. */}
        <Text style={s.sekce}>VI. Smluvní sankce a náhrada škody</Text>
        <Odrazka c="1.">
          Pro případ prodlení rodiče s úhradou školného se sjednává smluvní pokuta ve výši 0,1 % denně z
          dlužné částky a rodič se takto sjednanou smluvní pokutu zavazuje škole uhradit nejpozději do
          patnácti dnů ode dne, kdy byl k její úhradě písemně vyzván.
        </Odrazka>
        <Odrazka c="2.">
          Rodič se podpisem této smlouvy zavazuje uhradit škodu, kterou způsobil žák během výuky nebo na
          akcích pořádaných školou včetně akcí nepovinných. Při stanovení výše náhrady bude postupováno
          podle § 2920 občanského zákoníku.
        </Odrazka>

        {/* VII. */}
        <Text style={s.sekce}>VII. Ustanovení společná a závěrečná</Text>
        <Odrazka c="1.">
          Dlouhodobá absence žáka ve škole není důvodem pro vrácení školného. Individuálně budou řešeny
          pouze zcela výjimečné případy.
        </Odrazka>
        <Odrazka c="2.">
          Právní vztahy vzniklé z této smlouvy se řídí příslušnými ustanoveními občanského zákoníku a
          dalšími obecně závaznými právními předpisy.
        </Odrazka>
        <Odrazka c="3.">
          Tuto smlouvu lze měnit a doplňovat pouze písemnými a v řadě číslovanými dodatky podepsanými oběma
          smluvními stranami této smlouvy. V rámci dodatku ke smlouvě se lze dohodnout (za příplatek) i na
          individuálních požadavcích rodičů, jako je rozšířená výuka některého předmětu (navýšení
          vyučovacích hodin), výuka dalších cizích jazyků, prodloužený pobyt ve školní družině, doprovod
          dítěte domů ze školy apod.
        </Odrazka>
        <Odrazka c="4.">
          Tato studijní smlouva je vyhotovena ve dvou exemplářích stejného znění a významu, přičemž každý z
          nich má hodnotu originálu. Po podpisu této smlouvy oběma smluvními stranami obdrží škola a rodič
          po jednom vyhotovení této smlouvy.
        </Odrazka>
        <Odrazka c="5.">
          Aktuálně platné náklady na nepovinné školní a mimoškolní aktivity jsou uváděny na webových
          stránkách školy.
        </Odrazka>
        <Odrazka c="6.">
          Zájem o výuku svého syna/dcery v Základní škole Vilekula potvrdí rodič vrácením podepsané
          Studijní smlouvy a zaplacením školného za 1. měsíc do pěti dnů od podpisu smlouvy. Tato úhrada je
          považována za nevratnou kauci. Po úhradě této 1. splátky školného a vrácení podepsané smlouvy
          nabývá Studijní smlouva platnost.
        </Odrazka>
        <Odrazka c="7.">
          V případě nedodržení výše uvedených podmínek pozbývá přijetí žáka platnost a škola si vyhrazuje
          právo obsadit volné místo.
        </Odrazka>
        <Odrazka c="8.">
          Smluvní strany této smlouvy shodně prohlašují a konstatují, že tato smlouva byla sepsána a jimi
          podepsána na základě jejich svobodné vůle, ne v tísni ani za nápadně nevýhodných podmínek, že si
          její text před podpisem řádně přečetly, rozumí mu a bez výhrad s ním souhlasí.
        </Odrazka>

        <Text style={{ marginTop: 14 }}>V {SKOLA.mesto === 'Teplice' ? 'Teplicích' : SKOLA.mesto} dne: {DOTS}</Text>

        <View style={s.podpisy} wrap={false}>
          <View style={s.podpisSl}>
            <View style={s.podpisLine} />
            <Text>{SKOLA.reditel}, ředitel školy</Text>
          </View>
          <View style={s.podpisSl}>
            <View style={s.podpisLine} />
            <Text>rodič</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          Nilsson · školní informační systém pro alternativní školy · nilsson.cz
        </Text>
      </Page>
    </Document>
  )
}

export async function renderStudijniSmlouvaPdf(d: StudijniSmlouvaData): Promise<Buffer> {
  ensureFont()
  return renderToBuffer(<SmlouvaDocument d={d} />)
}
