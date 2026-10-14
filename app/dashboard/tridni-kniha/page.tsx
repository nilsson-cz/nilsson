// app/dashboard/tridni-kniha/page.tsx
// Server Component — seznam záznamů třídní knihy

import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config';
import HledaniVysledky, { type HledaniRadek } from './_components/HledaniVysledky';

type TKZaznam = {
  id: string;
  datum: string;
  den_v_tydnu: string;
  cas_od: string | null;
  cas_do: string | null;
  nazev: string;
  popis: string | null;
  typ_zaznamu: string;
  school_year: string;
  group_id: string | null;
  created_at: string;
  svp_vazby: { id: string }[];
};

type Group = { id: string; name: string };

const TYP_LABELS: Record<string, string> = {
  vyuka: 'Výuka',
  expedice: 'Expedice',
  projekt: 'Projekt',
  prazdniny: 'Prázdniny',
  reditelske_volno: 'Ředitelské volno',
  sportovni_kurz: 'Sportovní kurz',
  kulturni_akce: 'Kulturní akce',
};

const TYP_COLOR: Record<string, string> = {
  vyuka: 'bg-blue-50 text-blue-700 border-blue-200',
  expedice: 'bg-green-50 text-green-700 border-green-200',
  projekt: 'bg-purple-50 text-purple-700 border-purple-200',
  prazdniny: 'bg-gray-50 text-gray-500 border-gray-200',
  reditelske_volno: 'bg-orange-50 text-orange-700 border-orange-200',
  sportovni_kurz: 'bg-teal-50 text-teal-700 border-teal-200',
  kulturni_akce: 'bg-pink-50 text-pink-700 border-pink-200',
};

function formatDatum(dateStr: string): string {
  try {
    return format(new Date(dateStr + 'T12:00:00'), 'd. M. yyyy', { locale: cs });
  } catch {
    return dateStr;
  }
}

interface PageProps {
  searchParams: Promise<{ rok?: string; group_id?: string; q?: string; vse?: string }>;
}

export default async function TridniKnihaPage({ searchParams }: PageProps) {
  const supabase = await createSupabaseServerClient();

  const { rok, group_id, q: qRaw, vse } = await searchParams;
  const schoolYear = rok ?? CURRENT_SCHOOL_YEAR;
  // Vyhledávání (migrace 153): aktivní od 2 znaků; vse=1 → všechny školní roky.
  const q = (qRaw ?? '').trim().slice(0, 200);
  const hledani = q.length >= 2;
  const vseRoky = hledani && vse === '1';
  // Přepnutí třídy během hledání hledání zachová.
  const qParam = hledani ? `&q=${encodeURIComponent(q)}${vseRoky ? '&vse=1' : ''}` : '';

  let query = supabase
    .from('tridni_kniha_zaznamy')
    .select('*, svp_vazby(id)')
    .eq('school_year', schoolYear);

  if (group_id) {
    query = query.eq('group_id', group_id);
  }

  const { data: zaznamy, error } = await query
    .order('datum', { ascending: false })
    .returns<TKZaznam[]>();

  const { data: skolniRok } = await supabase
    .from('tridni_kniha_skolni_rok')
    .select('locked, locked_at')
    .eq('school_year', schoolYear)
    .single();

  const isLocked = (skolniRok as any)?.locked ?? false;

  // Třídy školního roku — pro štítek třídy u záznamu a filtr (fetch zvlášť, bez embedu).
  const { data: groupsRaw } = await supabase
    .from('groups')
    .select('id, name')
    .eq('school_year', schoolYear)
    .order('name');
  const groups = (groupsRaw ?? []) as Group[];
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  let vysledky: HledaniRadek[] = [];
  let hledaniError: string | null = null;
  if (hledani) {
    const { data, error: e } = await supabase.rpc('hledej_v_tridnici', {
      p_q: q,
      p_school_year: vseRoky ? undefined : schoolYear,
      p_group_id: vseRoky ? undefined : group_id,
    });
    if (e) hledaniError = e.message;
    vysledky = (data ?? []) as unknown as HledaniRadek[];
    if (vseRoky) {
      // Štítky tříd i z jiných školních let.
      const { data: vsechny } = await supabase.from('groups').select('id, name');
      for (const g of (vsechny ?? []) as Group[]) if (!groupName.has(g.id)) groupName.set(g.id, g.name);
    }
  }
  const selectedGroupName = group_id ? groupName.get(group_id) : undefined;

  // Export do PDF (ředitel + readonly). Výchozí období = začátek roku až dnes (max. konec června).
  const { data: { user } } = await supabase.auth.getUser();
  const { data: meRaw } = user
    ? await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
    : { data: null };
  const mojeRole = (meRaw as { role?: string } | null)?.role;
  const smiExport = mojeRole === 'director' || mojeRole === 'readonly';
  const rokOd = Number(schoolYear.slice(0, 4));
  const exportOd = `${rokOd}-09-01`;
  const dnes = new Date().toISOString().slice(0, 10);
  const konecRoku = `${rokOd + 1}-06-30`;
  const exportDo = dnes < exportOd ? exportOd : dnes > konecRoku ? konecRoku : dnes;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* Hlavička */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Třídní kniha</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-500">Školní rok {schoolYear}</span>
            {isLocked && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
                </svg>
                Zamčeno
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden text-sm">
            {SCHOOL_YEAR_OPTIONS.map((r) => (
              <Link
                key={r}
                href={`/dashboard/tridni-kniha?rok=${encodeURIComponent(r)}`}
                className={`px-3 py-1.5 ${
                  r === schoolYear ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {r}
              </Link>
            ))}
          </div>

          {/* Export do PDF (ředitel + readonly) — barevné tlačítko, formulář se rozbalí pod ním */}
          {smiExport && groups.length > 0 && (
            <details className="relative">
              <summary className="list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1.5 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 cursor-pointer select-none transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M6 20h12a2 2 0 002-2V8.414a1 1 0 00-.293-.707l-4.414-4.414A1 1 0 0014.586 3H6a2 2 0 00-2 2v13a2 2 0 002 2z" />
                </svg>
                Export PDF
              </summary>
              <form
                method="get"
                action="/dashboard/tridni-kniha/export"
                className="absolute right-0 top-full mt-2 z-20 w-72 bg-white border border-emerald-200 rounded-xl shadow-lg p-4 flex flex-col gap-3 text-sm"
              >
                <div className="font-medium text-gray-900">Export třídní knihy do PDF</div>
                <label className="flex flex-col gap-1 text-gray-500">
                  Třída
                  <select name="group_id" defaultValue={group_id ?? groups[0].id} className="border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900">
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <label className="flex flex-col gap-1 text-gray-500 flex-1">
                    Od
                    <input type="date" name="od" defaultValue={exportOd} required className="border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900" />
                  </label>
                  <label className="flex flex-col gap-1 text-gray-500 flex-1">
                    Do
                    <input type="date" name="do" defaultValue={exportDo} required className="border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900" />
                  </label>
                </div>
                <button type="submit" className="bg-emerald-600 text-white font-medium rounded-lg px-4 py-2 hover:bg-emerald-700">
                  Stáhnout PDF
                </button>
                <p className="text-xs text-gray-400">
                  Strana za každý den se zápisem. Celý rok se generuje i desítky sekund.
                </p>
              </form>
            </details>
          )}

          {!isLocked && (
            <Link
              href="/dashboard/tridni-kniha/den"
              className="inline-flex items-center gap-1.5 bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Zápis dne
            </Link>
          )}
        </div>
      </div>

      {/* Filtr tříd */}
      {groups.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <Link
            href={`/dashboard/tridni-kniha?rok=${encodeURIComponent(schoolYear)}${qParam}`}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
              !group_id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Všechny třídy
          </Link>
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/dashboard/tridni-kniha?rok=${encodeURIComponent(schoolYear)}&group_id=${g.id}${qParam}`}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                group_id === g.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {g.name}
            </Link>
          ))}
        </div>
      )}


      {/* Vyhledávání */}
      <form method="get" action="/dashboard/tridni-kniha" className="mb-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="rok" value={schoolYear} />
        {group_id && <input type="hidden" name="group_id" value={group_id} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Hledat v zápisech a ŠVP výstupech…"
          className="flex-1 min-w-[12rem] text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-400"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          <input type="checkbox" name="vse" value="1" defaultChecked={vse === '1'} />
          všechny školní roky
        </label>
        <button type="submit" className="text-sm font-medium border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
          Hledat
        </button>
        {hledani && (
          <Link
            href={`/dashboard/tridni-kniha?rok=${encodeURIComponent(schoolYear)}${group_id ? `&group_id=${group_id}` : ''}`}
            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            zrušit hledání
          </Link>
        )}
      </form>

      {hledani && hledaniError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Hledání selhalo: {hledaniError}
        </div>
      )}

      {hledani && !hledaniError && (
        <HledaniVysledky q={q} radky={vysledky} groupName={groupName} vseRoky={vseRoky} />
      )}

      {!hledani && (<>
      {/* Chyba */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Nepodařilo se načíst záznamy: {error.message}
        </div>
      )}

      {/* Filtr třídy — banner (viditelný i když se chipy nezobrazí, tj. jedna třída) */}
      {group_id && (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <span>Filtrováno: třída {selectedGroupName ?? '—'}</span>
          <Link
            href={`/dashboard/tridni-kniha?rok=${encodeURIComponent(schoolYear)}`}
            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            zrušit filtr
          </Link>
        </div>
      )}

      {/* Prázdný stav */}
      {!error && (!zaznamy || zaznamy.length === 0) && (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm">Žádné záznamy pro školní rok {schoolYear}</p>
          {!isLocked && (
            <Link href="/dashboard/tridni-kniha/den" className="mt-3 inline-block text-sm text-gray-900 font-medium underline underline-offset-2">
              Přidat první záznam
            </Link>
          )}
        </div>
      )}

      {/* Seznam záznamů */}
      {zaznamy && zaznamy.length > 0 && (
        <div className="space-y-1">
          {zaznamy.map((z) => (
            <Link
              key={z.id}
              href={`/dashboard/tridni-kniha/${z.id}`}
              className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100 transition-all group"
            >
              <div className="w-28 shrink-0 text-sm">
                <div className="font-medium text-gray-900">{formatDatum(z.datum)}</div>
                <div className="text-gray-400 text-xs uppercase tracking-wide">{z.den_v_tydnu}</div>
              </div>

              <div className="w-32 shrink-0">
                <span className={`inline-block text-xs font-medium border rounded-full px-2 py-0.5 ${TYP_COLOR[z.typ_zaznamu] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                  {TYP_LABELS[z.typ_zaznamu] ?? z.typ_zaznamu}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {z.group_id && groupName.get(z.group_id) && (
                    <span className="shrink-0 text-xs font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                      {groupName.get(z.group_id)}
                    </span>
                  )}
                  <div className="font-medium text-gray-900 group-hover:text-gray-700 truncate">{z.nazev}</div>
                </div>
                {z.popis && (
                  <div className="text-sm text-gray-400 truncate">{z.popis}</div>
                )}
              </div>

              {z.cas_od && (
                <div className="shrink-0 text-xs text-gray-400">
                  {z.cas_od.slice(0, 5)}{z.cas_do ? `–${z.cas_do.slice(0, 5)}` : ''}
                </div>
              )}

              {z.svp_vazby.length > 0 && (
                <div className="shrink-0 text-xs text-gray-400 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {z.svp_vazby.length}
                </div>
              )}

              <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}

      {/* Statistiky */}
      {zaznamy && zaznamy.length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-100 flex gap-6 text-sm text-gray-500">
          <span>{zaznamy.length} záznamů</span>
          <span>{zaznamy.filter((z) => z.typ_zaznamu === 'vyuka').length} výukových dnů</span>
          <span>{zaznamy.filter((z) => z.svp_vazby.length > 0).length} se SVP vazbami</span>
        </div>
      )}
      </>)}
    </div>
  );
}
