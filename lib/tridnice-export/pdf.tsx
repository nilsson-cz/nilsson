// lib/tridnice-export/pdf.tsx
// PDF export třídní knihy jedné třídy (@react-pdf/renderer). Server-only.
// Rozvržení podle vzoru školy (ZŠ Vilekula Třídní kniha 2025/2026):
//   úvod = identifikace školy, pedagogičtí pracovníci, seznam žáků, nezapsané dny;
//   pak strana za každý den v třídnici: průvodci, program dne (bloky),
//   evidence docházky, ŠVP výstupy po ročnících, poznámky (příznaky).
// Podpisy jen na úvodní straně (pedagogové za celé období + ředitel, razítko).
// Font Geist (jediný řez) z katalogového listu — zvýraznění velikostí/barvou.
// POZOR: lineHeight NESMÍ být na <Page> — react-pdf pak nevykreslí fixed Text
// s render prop (číslo strany v patičce). Proto je na obalovém View (s.body).

import 'server-only';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { ensureFont, SKOLA } from '@/lib/enrollment/pdf/layout';
import type { ExportDen, TridniceExportData } from './types';

const SKOLA_EXTRA = {
  pravniForma: process.env.SCHOOL_PRAVNI_FORMA ?? 'Školská právnická osoba (§ 124–140 školského zákona)',
  mistoVzdelavani: process.env.SCHOOL_MISTO_VZDELAVANI ?? 'Kapelní 768/2, Teplice',
};

const TYP_LABEL: Record<string, string> = {
  vyuka: 'Výuka',
  expedice: 'Expedice',
  projekt: 'Projekt',
  prazdniny: 'Prázdniny',
  reditelske_volno: 'Ředitelské volno',
  sportovni_kurz: 'Sportovní kurz',
  kulturni_akce: 'Kulturní akce',
};

const DNY = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
const MESICE = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

function datumDlouhe(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${DNY[d.getDay()]}, ${d.getDate()}. ${MESICE[d.getMonth()]} ${d.getFullYear()}`;
}

function datumKratke(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

const C = {
  text: '#1a1a1a',
  muted: '#6b7280',
  line: '#d1d5db',
  lineStrong: '#374151',
  bgHead: '#f3f4f6',
};

const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 38, paddingHorizontal: 36, fontFamily: 'Geist', fontSize: 8.5, color: C.text },
  // fontSize i tady: View přepočte lineHeight na body ze svého písma a dědí absolutní hodnotu.
  body: { fontSize: 8.5, lineHeight: 1.35 },
  runHead: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.75, borderBottomColor: C.lineStrong, paddingBottom: 3, marginBottom: 8, fontSize: 8, color: C.muted },
  footer: { position: 'absolute', bottom: 18, left: 36, right: 36, fontSize: 7, color: C.muted, textAlign: 'center' },

  titulSkola: { fontSize: 13, marginTop: 12, textAlign: 'center', lineHeight: 1.3 },
  titulNazev: { fontSize: 22, marginTop: 6, textAlign: 'center', letterSpacing: 1, lineHeight: 1.3 },
  titulSub: { fontSize: 10, color: C.muted, marginTop: 4, marginBottom: 14, textAlign: 'center' },

  sectionTitle: { fontSize: 7.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 6, marginBottom: 3, borderBottomWidth: 0.5, borderBottomColor: C.line, paddingBottom: 2 },
  row: { flexDirection: 'row', marginBottom: 1.5 },
  label: { width: 130, color: C.muted },
  value: { flex: 1 },

  tHead: { flexDirection: 'row', backgroundColor: C.bgHead, paddingVertical: 2.5, paddingHorizontal: 4 },
  tRow: { flexDirection: 'row', paddingVertical: 0.9, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: C.line },
  th: { color: C.muted, fontSize: 7.5 },

  denTitul: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 2 },
  denDatum: { fontSize: 12, lineHeight: 1.3 },
  denTyp: { fontSize: 7.5, color: C.muted, borderWidth: 0.5, borderColor: C.line, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  pruvodci: { color: C.muted, marginBottom: 4 },

  blok: { flexDirection: 'row', marginBottom: 2.5 },
  blokCas: { width: 62, color: C.muted },
  blokText: { flex: 1 },

  svpRocnik: { flexDirection: 'row', marginBottom: 3 },
  svpRocnikLabel: { width: 34, color: C.muted },

  muted: { color: C.muted },
  podpisy: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  podpisLine: { width: 210, borderTopWidth: 0.5, borderTopColor: C.lineStrong, paddingTop: 3, color: C.muted, textAlign: 'center' },
});

function Sekce({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={s.sectionTitle} minPresenceAhead={30}>{title}</Text>
      {children}
    </View>
  );
}

function Radek({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value || '—'}</Text>
    </View>
  );
}

function Patka({ d }: { d: TridniceExportData }) {
  return (
    <Text
      style={s.footer}
      fixed
      render={({ pageNumber, totalPages }) =>
        `${SKOLA.nazevKratky} · Třídní kniha ${d.skolniRok} · ${d.trida} · strana ${pageNumber} / ${totalPages}`
      }
    />
  );
}

function Uvod({ d }: { d: TridniceExportData }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.body}>
      <Text style={s.titulSkola}>{SKOLA.nazev}</Text>
      <Text style={s.titulNazev}>TŘÍDNÍ KNIHA {d.skolniRok}</Text>
      <Text style={s.titulSub}>
        Třída: {d.trida} · období {datumKratke(d.od)} – {datumKratke(d.do)}
      </Text>

      <Sekce title="Identifikační údaje školy">
        <Radek label="Název" value={SKOLA.nazev} />
        <Radek label="Právní forma" value={SKOLA_EXTRA.pravniForma} />
        <Radek label="RED IZO" value={SKOLA.redIzo} />
        <Radek label="IČO" value={SKOLA.ico} />
        <Radek label="Sídlo" value={SKOLA.adresa} />
        <Radek label="Místo vzdělávání" value={SKOLA_EXTRA.mistoVzdelavani} />
        <Radek label="Datová schránka" value={SKOLA.ds} />
      </Sekce>

      <Sekce title="Pedagogičtí pracovníci">
        <View style={s.tHead}>
          <Text style={[s.th, { width: 160 }]}>Jméno</Text>
          <Text style={[s.th, { width: 100 }]}>Role</Text>
          <Text style={[s.th, { flex: 1 }]}>Vyučované předměty</Text>
          <Text style={[s.th, { width: 110 }]}>Podpis</Text>
        </View>
        {d.pedagogove.map((p, i) => (
          <View key={i} style={[s.tRow, { paddingVertical: 5 }]} wrap={false}>
            <Text style={{ width: 160 }}>{p.jmeno}</Text>
            <Text style={{ width: 100 }}>{p.role}</Text>
            <Text style={{ flex: 1, paddingRight: 8 }}>{p.predmety.join(', ') || '—'}</Text>
            <Text style={{ width: 110 }}> </Text>
          </View>
        ))}
        <Text style={[s.muted, { marginTop: 3, fontSize: 7 }]}>
          Podpisem pedagogičtí pracovníci potvrzují zápisy v třídní knize za uvedené období.
        </Text>
      </Sekce>

      <Sekce title="Seznam žáků">
        <View style={s.tHead}>
          <Text style={[s.th, { width: 24 }]}>č.</Text>
          <Text style={[s.th, { width: 170 }]}>Příjmení a jméno</Text>
          <Text style={[s.th, { width: 32 }]}>Roč.</Text>
          <Text style={[s.th, { width: 70 }]}>Nástup</Text>
          <Text style={[s.th, { flex: 1 }]}>Poznámka</Text>
        </View>
        {d.zaci.map((z) => (
          <View key={z.cislo} style={s.tRow} wrap={false}>
            <Text style={{ width: 24 }}>{z.cislo}</Text>
            <Text style={{ width: 170 }}>{z.jmeno}</Text>
            <Text style={{ width: 32 }}>{z.rocnik ?? '—'}</Text>
            <Text style={{ width: 70 }}>{z.nastup ? datumKratke(z.nastup) : ''}</Text>
            <Text style={{ flex: 1 }}>{z.poznamka ?? ''}</Text>
          </View>
        ))}
      </Sekce>

      {d.nedoplneneDny.length > 0 && (
        <Sekce title={`Nezapsané výukové dny v období (${d.nedoplneneDny.length})`}>
          <Text>{d.nedoplneneDny.map(datumKratke).join(' · ')}</Text>
        </Sekce>
      )}

      <View wrap={false}>
        <View style={s.podpisy}>
          <Text style={s.podpisLine}>Razítko školy</Text>
          <Text style={s.podpisLine}>Podpis ředitele školy</Text>
        </View>
        <Text style={[s.muted, { marginTop: 6, fontSize: 7 }]}>Vygenerováno z IS Nilsson {datumKratke(d.vytvoreno)}.</Text>
      </View>
      </View>

      <Patka d={d} />
    </Page>
  );
}

function Den({ d, den }: { d: TridniceExportData; den: ExportDen }) {
  const programPrazdny = !den.popis?.trim() && den.bloky.length === 0;
  return (
    <Page size="A4" style={s.page}>
      <View style={s.runHead} fixed>
        <Text>{SKOLA.nazev}</Text>
        <Text>TŘÍDNÍ KNIHA {d.skolniRok} · {d.trida}</Text>
      </View>

      <View style={s.body}>
      <View style={s.denTitul}>
        <Text style={s.denDatum}>{datumDlouhe(den.datum)}</Text>
        {den.typ !== 'vyuka' && <Text style={s.denTyp}>{TYP_LABEL[den.typ] ?? den.typ}</Text>}
      </View>
      <Text style={s.pruvodci}>Průvodce/ci: {den.pruvodci.join(', ') || '—'}</Text>

      <Sekce title="Program dne">
        {den.nazev && den.bloky.length === 0 ? <Text style={{ marginBottom: 2 }}>{den.nazev}</Text> : null}
        {den.popis?.trim() ? <Text style={{ marginBottom: 3 }}>{den.popis.trim()}</Text> : null}
        {den.bloky.map((b, i) => (
          <View key={i} style={s.blok} wrap={false}>
            <Text style={s.blokCas}>{b.cas_od.slice(0, 5)}–{b.cas_do.slice(0, 5)}</Text>
            <Text style={s.blokText}>
              {b.nazev}
              {b.obsah?.trim() ? <Text style={s.muted}>{` — ${b.obsah.trim()}`}</Text> : null}
            </Text>
          </View>
        ))}
        {programPrazdny && !den.nazev ? <Text style={s.muted}>bez zápisu</Text> : null}
      </Sekce>

      <Sekce title="Evidence docházky">
        <View style={s.tHead}>
          <Text style={[s.th, { width: 24 }]}>č.</Text>
          <Text style={[s.th, { width: 170 }]}>Příjmení a jméno</Text>
          <Text style={[s.th, { width: 32 }]}>Roč.</Text>
          <Text style={[s.th, { width: 70 }]}>Absence (hod.)</Text>
          <Text style={[s.th, { flex: 1 }]}>Důvod / poznámka</Text>
        </View>
        {den.dochazka.map((r) => (
          <View key={r.cislo} style={s.tRow} wrap={false}>
            <Text style={{ width: 24 }}>{r.cislo}</Text>
            <Text style={{ width: 170 }}>{r.jmeno}</Text>
            <Text style={{ width: 32 }}>{r.rocnik ?? '—'}</Text>
            <Text style={{ width: 70 }}>{r.absenceHod ?? ''}</Text>
            <Text style={[{ flex: 1 }, r.poznamka?.startsWith('—') ? s.muted : {}]}>{r.poznamka ?? ''}</Text>
          </View>
        ))}
      </Sekce>

      <Sekce title="Očekávané výstupy učení dle ŠVP">
        {den.svp.length === 0 ? (
          <Text style={s.muted}>—</Text>
        ) : (
          den.svp.map((r) => (
            <View key={r.rocnik} style={s.svpRocnik}>
              <Text style={s.svpRocnikLabel}>{r.rocnik}. roč.</Text>
              <Text style={{ flex: 1 }}>
                {r.predmety.map((p, i) => (
                  <Text key={i}>
                    {i > 0 ? ' · ' : ''}
                    <Text style={s.muted}>{p.predmet}: </Text>
                    {p.vystupy.join(' / ')}
                  </Text>
                ))}
              </Text>
            </View>
          ))
        )}
      </Sekce>

      <Sekce title="Poznámky (BOZP, hospitace, mimořádné události)">
        {den.poznamky.length === 0 ? <Text style={s.muted}>—</Text> : den.poznamky.map((p, i) => <Text key={i}>{p}</Text>)}
      </Sekce>

      </View>

      <Patka d={d} />
    </Page>
  );
}

function TridniceDocument({ d }: { d: TridniceExportData }) {
  return (
    <Document title={`Třídní kniha ${d.skolniRok} — ${d.trida}`} author={SKOLA.nazev}>
      <Uvod d={d} />
      {d.dny.map((den) => (
        <Den key={den.id} d={d} den={den} />
      ))}
    </Document>
  );
}

export async function renderTridnicePdf(d: TridniceExportData): Promise<Buffer> {
  ensureFont();
  return renderToBuffer(<TridniceDocument d={d} />);
}
