// lib/tridnice-export/gather.ts
// Sběr dat pro PDF export třídní knihy jedné třídy za období od–do.
// Čte přes RLS přihlášeného uživatele (route pouští jen ředitele a readonly).
//
// Hromadné dotazy místo dotazu po dnech; PostgREST vrací max. 1000 řádků
// a dlouhé .in() seznamy rozbijí URL → stránkování (vsechny) + dávky (poDavkach).
//
// Vazba blok → den je stejná jako lib/tridni-kniha-den-text.ts nactiBlokyProZaznam
// (a RPC 152/153): blok patří třídě (rozvrh_blok_skupiny), není zrušený a je
// zapsaný, nebo přímo napojený na kontejner dne (tridni_zaznam_id).

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getHolidayDateSet } from '@/lib/school-calendar-server';
import { getMissingTKDays } from '@/lib/tridni-kniha-missing';
import { paragrafZpusobu } from '@/lib/zpusob-psd';
import type {
  ExportDen,
  ExportDochazka,
  ExportPedagog,
  ExportSvpRocnik,
  ExportZak,
  TridniceExportData,
} from './types';

type Sb = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const PAGE = 1000;
const DAVKA = 150;

type Pageable = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

/** Načte všechny stránky dotazu (builder musí mít stabilní .order()). */
async function vsechny<T>(build: () => Pageable): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Dotaz s .in() po dávkách id (+ stránkování uvnitř dávky). */
async function poDavkach<T>(ids: string[], build: (davka: string[]) => Pageable): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += DAVKA) {
    const davka = ids.slice(i, i + DAVKA);
    out.push(...(await vsechny<T>(() => build(davka))));
  }
  return out;
}

const ROLE_LABEL: Record<string, string> = {
  director: 'Ředitel',
  vp: 'Výchovný poradce',
  guide: 'Průvodce',
  assistant: 'Asistent pedagoga',
};

const STAV_LABEL: Record<string, string> = {
  absent_excused: 'omluveno',
  partially_excused: 'částečně omluveno',
  absent_unexcused: 'neomluveno',
  late: 'pozdní příchod',
  remote: 'distanční výuka',
};

const PARAGRAF_POZNAMKA: Record<string, string> = {
  '38': 'vzdělávání v zahraničí',
  '41': 'individuální vzdělávání',
};

function jmenoStaff(s: { first_name: string; last_name: string } | undefined): string {
  return s ? `${s.first_name} ${s.last_name}`.trim() : '—';
}

function vRozsahu(datum: string, od: string, doo: string | null): boolean {
  return datum >= od && (doo === null || datum <= doo);
}

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

export async function gatherTridniceExport(
  groupId: string,
  od: string,
  doo: string,
): Promise<TridniceExportData | null> {
  const sb: Sb = await createSupabaseServerClient();

  const { data: grp } = await sb.from('groups').select('id, name, school_year').eq('id', groupId).maybeSingle();
  if (!grp) return null;
  const skolniRok = grp.school_year;
  const zacatekRoku = `${skolniRok.slice(0, 4)}-09-01`;

  // --- žáci třídy v období ----------------------------------------------------
  type Clen = { student_id: string; valid_from: string; valid_to: string | null };
  const clenstvi = await vsechny<Clen>(() =>
    sb.from('group_memberships')
      .select('student_id, valid_from, valid_to')
      .eq('group_id', groupId)
      .lte('valid_from', doo)
      .or(`valid_to.is.null,valid_to.gte.${od}`)
      .order('id'),
  );
  const studentIds = [...new Set(clenstvi.map((c) => c.student_id))];

  type Stud = { id: string; first_name: string; last_name: string };
  const studenti = await poDavkach<Stud>(studentIds, (d) =>
    sb.from('students').select('id, first_name, last_name').in('id', d).order('id'),
  );

  type Mode = { student_id: string; rocnik: number | null; zpusob: string; valid_from: string; valid_to: string | null };
  const rezimy = await poDavkach<Mode>(studentIds, (d) =>
    sb.from('student_education_mode')
      .select('student_id, rocnik, zpusob, valid_from, valid_to')
      .in('student_id', d)
      .lte('valid_from', doo)
      .or(`valid_to.is.null,valid_to.gte.${zacatekRoku}`)
      .order('id'),
  );
  const rezimyZaka = new Map<string, Mode[]>();
  for (const r of rezimy) {
    const l = rezimyZaka.get(r.student_id) ?? [];
    l.push(r);
    rezimyZaka.set(r.student_id, l);
  }
  for (const l of rezimyZaka.values()) l.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  const rezimKDatu = (sid: string, datum: string) =>
    [...(rezimyZaka.get(sid) ?? [])].reverse().find((r) => vRozsahu(datum, r.valid_from, r.valid_to));
  const rocnikZaka = (sid: string) =>
    (rezimKDatu(sid, doo) ?? [...(rezimyZaka.get(sid) ?? [])].reverse().find((r) => r.rocnik != null))?.rocnik ?? null;

  const clenyZaka = new Map<string, Clen[]>();
  for (const c of clenstvi) clenyZaka.set(c.student_id, [...(clenyZaka.get(c.student_id) ?? []), c]);

  const serazeni = [...studenti].sort(
    (a, b) =>
      (rocnikZaka(a.id) ?? 99) - (rocnikZaka(b.id) ?? 99) ||
      a.last_name.localeCompare(b.last_name, 'cs') ||
      a.first_name.localeCompare(b.first_name, 'cs'),
  );

  const zaci: ExportZak[] = serazeni.map((st, i) => {
    const cl = (clenyZaka.get(st.id) ?? []).sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    const prvni = cl[0]?.valid_from ?? null;
    const posledniDo = cl.some((c) => c.valid_to === null) ? null : cl.map((c) => c.valid_to!).sort().pop() ?? null;
    const poznamky: string[] = [];
    // Změna způsobu plnění PŠD mimo § 36 během období.
    for (const r of rezimyZaka.get(st.id) ?? []) {
      const p = paragrafZpusobu(r.zpusob);
      if (p && p !== '36' && r.valid_from <= doo && (r.valid_to === null || r.valid_to >= od)) {
        poznamky.push(`od ${fmt(r.valid_from > zacatekRoku ? r.valid_from : zacatekRoku)} ${PARAGRAF_POZNAMKA[p]} (§ ${p})`);
      }
    }
    if (posledniDo && posledniDo <= doo) poznamky.push(`odchod ${fmt(posledniDo)}`);
    return {
      cislo: i + 1,
      jmeno: `${st.last_name} ${st.first_name}`.trim(),
      rocnik: rocnikZaka(st.id),
      nastup: prvni && prvni > zacatekRoku ? prvni : null,
      poznamka: poznamky.join('; ') || null,
    };
  });
  const cisloZaka = new Map(serazeni.map((st, i) => [st.id, i + 1]));

  // --- dny třídnice -----------------------------------------------------------
  type Zaznam = { id: string; datum: string; nazev: string; popis: string | null; typ_zaznamu: string };
  const zaznamy = await vsechny<Zaznam>(() =>
    sb.from('tridni_kniha_zaznamy')
      .select('id, datum, nazev, popis, typ_zaznamu')
      .eq('group_id', groupId)
      .gte('datum', od)
      .lte('datum', doo)
      .order('datum')
      .order('id'),
  );
  const zaznamIds = zaznamy.map((z) => z.id);
  const datumy = new Set(zaznamy.map((z) => z.datum));

  // --- bloky dne (vazba jako nactiBlokyProZaznam) -----------------------------
  type Blok = {
    id: string; datum: string; cas_od: string; cas_do: string; nazev: string;
    obsah: string | null; stav: string; potvrzeno_at: string | null; tridni_zaznam_id: string | null;
  };
  const vsechnyBloky = await vsechny<Blok>(() =>
    sb.from('rozvrh_blok')
      .select('id, datum, cas_od, cas_do, nazev, obsah, stav, potvrzeno_at, tridni_zaznam_id')
      .gte('datum', od)
      .lte('datum', doo)
      .neq('stav', 'zruseno')
      .order('id'),
  );
  const blokyTridy = new Set(
    (await vsechny<{ blok_id: string }>(() =>
      sb.from('rozvrh_blok_skupiny').select('blok_id').eq('group_id', groupId).order('blok_id'),
    )).map((k) => k.blok_id),
  );
  const zaznamPodleData = new Map(zaznamy.map((z) => [z.datum, z.id]));
  const blokyDne = new Map<string, Blok[]>();
  for (const b of vsechnyBloky) {
    const zid = zaznamPodleData.get(b.datum);
    if (!zid || !blokyTridy.has(b.id)) continue;
    if (!b.potvrzeno_at && b.tridni_zaznam_id !== zid) continue;
    blokyDne.set(zid, [...(blokyDne.get(zid) ?? []), b]);
  }
  for (const l of blokyDne.values()) l.sort((a, b) => a.cas_od.localeCompare(b.cas_od));
  const blokIds = [...blokyDne.values()].flat().map((b) => b.id);
  const denBloku = new Map<string, string>();
  for (const [zid, l] of blokyDne) for (const b of l) denBloku.set(b.id, zid);

  // --- obsazení (personální zajištění) + příznaky -----------------------------
  type Obs = { blok_id: string; staff_id: string; zapocitat_ppc: boolean; je_suplovani: boolean; supluje_za_staff_id: string | null };
  const obsazeni = await poDavkach<Obs>(blokIds, (d) =>
    sb.from('rozvrh_obsazeni')
      .select('blok_id, staff_id, zapocitat_ppc, je_suplovani, supluje_za_staff_id')
      .in('blok_id', d)
      .order('id'),
  );
  type Priz = { blok_id: string; typ_kod: string; osoba_staff_id: string | null; poznamka: string | null };
  const priznaky = await poDavkach<Priz>(blokIds, (d) =>
    sb.from('rozvrh_blok_priznak').select('blok_id, typ_kod, osoba_staff_id, poznamka').in('blok_id', d).order('id'),
  );
  const { data: typyRaw } = await sb.from('tridnice_priznak_typ').select('kod, nazev, poradi');
  const typPriznaku = new Map((typyRaw ?? []).map((t) => [t.kod, t]));

  type Staff = { id: string; first_name: string; last_name: string; role: string; typ_zamestnance: string; employment_type: string | null };
  const { data: staffRaw } = await sb
    .from('staff')
    .select('id, first_name, last_name, role, typ_zamestnance, employment_type');
  const staff = new Map(((staffRaw ?? []) as Staff[]).map((s) => [s.id, s]));

  // --- ŠVP --------------------------------------------------------------------
  type Vazba = { zaznam_id: string; vystup_id: string; rocnik: number };
  const vazby = await poDavkach<Vazba>(zaznamIds, (d) =>
    sb.from('svp_vazby').select('zaznam_id, vystup_id, rocnik').in('zaznam_id', d).order('id'),
  );
  type Vystup = { id: string; predmet: string; vystup_text: string };
  const vystupy = await poDavkach<Vystup>([...new Set(vazby.map((v) => v.vystup_id))], (d) =>
    sb.from('svp_vystupy').select('id, predmet, vystup_text').in('id', d).order('id'),
  );
  const vystup = new Map(vystupy.map((v) => [v.id, v]));

  // --- docházka ---------------------------------------------------------------
  type Att = { student_id: string; date: string; status: string; hodiny: number | null };
  const dochazka = await vsechny<Att>(() =>
    sb.from('attendance_records')
      .select('student_id, date, status, hodiny')
      .eq('group_id', groupId)
      .gte('date', od)
      .lte('date', doo)
      .neq('status', 'present')
      .order('id'),
  );
  const absence = new Map<string, Att>();
  for (const a of dochazka) absence.set(`${a.date}|${a.student_id}`, a);

  // --- skládání dnů -----------------------------------------------------------
  const predmetyOsoby = new Map<string, Map<string, number>>();

  const dny: ExportDen[] = zaznamy.map((z) => {
    const bloky = blokyDne.get(z.id) ?? [];
    const idsBloku = new Set(bloky.map((b) => b.id));

    // Průvodci: obsazení bloků dne bez nepřítomných (zapocitat_ppc = false).
    const osoby = new Map<string, string>();
    for (const o of obsazeni) {
      if (!idsBloku.has(o.blok_id) || !o.zapocitat_ppc) continue;
      const suplZa = o.je_suplovani && o.supluje_za_staff_id ? ` (suplování za ${jmenoStaff(staff.get(o.supluje_za_staff_id))})` : '';
      if (!osoby.has(o.staff_id) || suplZa) osoby.set(o.staff_id, jmenoStaff(staff.get(o.staff_id)) + suplZa);
    }

    // ŠVP po ročnících a předmětech.
    const poRocniku = new Map<number, Map<string, string[]>>();
    for (const v of vazby) {
      if (v.zaznam_id !== z.id) continue;
      const vy = vystup.get(v.vystup_id);
      if (!vy) continue;
      const m = poRocniku.get(v.rocnik) ?? new Map<string, string[]>();
      m.set(vy.predmet, [...(m.get(vy.predmet) ?? []), vy.vystup_text]);
      poRocniku.set(v.rocnik, m);
      for (const sid of osoby.keys()) {
        const pm = predmetyOsoby.get(sid) ?? new Map<string, number>();
        pm.set(vy.predmet, (pm.get(vy.predmet) ?? 0) + 1);
        predmetyOsoby.set(sid, pm);
      }
    }
    const svp: ExportSvpRocnik[] = [...poRocniku.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rocnik, m]) => ({
        rocnik,
        predmety: [...m.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], 'cs'))
          .map(([predmet, l]) => ({ predmet, vystupy: [...new Set(l)] })),
      }));

    // Docházka žáků.
    const radky: ExportDochazka[] = serazeni.map((st) => {
      const base = { cislo: cisloZaka.get(st.id)!, jmeno: `${st.last_name} ${st.first_name}`.trim(), rocnik: rocnikZaka(st.id) };
      const clen = (clenyZaka.get(st.id) ?? []).some((c) => vRozsahu(z.datum, c.valid_from, c.valid_to));
      if (!clen) return { ...base, absenceHod: null, poznamka: '— mimo evidenci' };
      const p = paragrafZpusobu(rezimKDatu(st.id, z.datum)?.zpusob ?? '11');
      if (p && p !== '36') return { ...base, absenceHod: null, poznamka: `— ${PARAGRAF_POZNAMKA[p]}` };
      const a = absence.get(`${z.datum}|${st.id}`);
      if (!a) return { ...base, absenceHod: null, poznamka: null };
      return { ...base, absenceHod: a.hodiny ?? null, poznamka: STAV_LABEL[a.status] ?? a.status };
    });

    // Poznámky = příznaky bloků dne (hospitace, BOZP, …).
    const poznamky = priznaky
      .filter((p) => denBloku.get(p.blok_id) === z.id)
      .sort((a, b) => (typPriznaku.get(a.typ_kod)?.poradi ?? 0) - (typPriznaku.get(b.typ_kod)?.poradi ?? 0))
      .map((p) => {
        const typ = typPriznaku.get(p.typ_kod)?.nazev ?? p.typ_kod;
        const osoba = p.osoba_staff_id ? `: ${jmenoStaff(staff.get(p.osoba_staff_id))}` : '';
        const pozn = p.poznamka?.trim() ? ` — ${p.poznamka.trim()}` : '';
        return `${typ}${osoba}${pozn}`;
      });

    return {
      id: z.id,
      datum: z.datum,
      typ: z.typ_zaznamu,
      nazev: z.nazev,
      popis: z.popis,
      pruvodci: [...osoby.values()],
      bloky: bloky.map((b) => ({ cas_od: b.cas_od, cas_do: b.cas_do, nazev: b.nazev, obsah: b.obsah })),
      dochazka: radky,
      svp,
      poznamky: [...new Set(poznamky)],
    };
  });

  // --- pedagogičtí pracovníci -------------------------------------------------
  const ucastnici = new Set(obsazeni.filter((o) => o.zapocitat_ppc).map((o) => o.staff_id));
  for (const s of staff.values()) if (s.role === 'director') ucastnici.add(s.id);
  const poradiRole = (r: string) => (r === 'director' ? 0 : r === 'assistant' ? 2 : 1);
  const pedagogove: ExportPedagog[] = [...ucastnici]
    .map((id) => staff.get(id))
    .filter((s): s is Staff => !!s && s.role !== 'readonly')
    .sort((a, b) => poradiRole(a.role) - poradiRole(b.role) || a.last_name.localeCompare(b.last_name, 'cs'))
    .map((s) => {
      let role = s.typ_zamestnance === 'THP' ? 'Administrativa' : ROLE_LABEL[s.role] ?? s.role;
      if (s.role === 'guide' && (s.employment_type === 'dpp' || s.employment_type === 'dpc')) role = 'Externista';
      const bezPredmetu = s.role === 'assistant' || s.typ_zamestnance === 'THP';
      const predmety = bezPredmetu
        ? []
        : [...(predmetyOsoby.get(s.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
      return { jmeno: jmenoStaff(s), role, predmety };
    });

  // --- nezapsané výukové dny v období -----------------------------------------
  const svatky = await getHolidayDateSet(skolniRok);
  const nedoplneneDny = getMissingTKDays(skolniRok, datumy, svatky).filter((d) => d >= od && d <= doo);

  return {
    trida: grp.name,
    skolniRok,
    od,
    do: doo,
    vytvoreno: new Date().toISOString().slice(0, 10),
    pedagogove,
    zaci,
    dny,
    nedoplneneDny,
  };
}
