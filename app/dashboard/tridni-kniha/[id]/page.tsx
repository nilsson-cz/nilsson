// app/dashboard/tridni-kniha/[id]/page.tsx
// Server Component — detail záznamu třídní knihy

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { nactiBlokyProZaznam } from '@/lib/tridni-kniha-den-text';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';

type SvpVazba = {
  id: string;
  rocnik: number;
  zdroj: string;
  svp_vystupy: {
    kod: string;
    predmet: string;
    vystup_text: string;
  };
};

type TKZaznamDetail = {
  id: string;
  datum: string;
  den_v_tydnu: string;
  cas_od: string | null;
  cas_do: string | null;
  nazev: string;
  popis: string | null;
  typ_zaznamu: string;
  school_year: string;
  created_at: string;
  updated_at: string;
  svp_vazby: SvpVazba[];
};

const TYP_LABELS: Record<string, string> = {
  vyuka: 'Výuka',
  expedice: 'Expedice',
  projekt: 'Projekt',
  prazdniny: 'Prázdniny',
  reditelske_volno: 'Ředitelské volno',
  sportovni_kurz: 'Sportovní kurz',
  kulturni_akce: 'Kulturní akce',
};

function formatDatumFull(dateStr: string): string {
  try {
    return format(new Date(dateStr + 'T12:00:00'), 'EEEE d. MMMM yyyy', { locale: cs });
  } catch {
    return dateStr;
  }
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TKZaznamDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: zaznam, error } = await supabase
    .from('tridni_kniha_zaznamy')
    .select(`
      *,
      svp_vazby (
        id,
        rocnik,
        zdroj,
        svp_vystupy ( kod, predmet, vystup_text )
      )
    `)
    .eq('id', id)
    .single<TKZaznamDetail>();

  if (error || !zaznam) notFound();

  // Průběh dne se odvozuje z napojených bloků rozvrhu (zdroj pravdy = rozvrh_blok.obsah).
  const bloky = await nactiBlokyProZaznam(supabase, zaznam.id);

  const { data: skolniRok } = await supabase
    .from('tridni_kniha_skolni_rok')
    .select('locked')
    .eq('school_year', zaznam.school_year)
    .single();

  const isLocked = (skolniRok as any)?.locked ?? false;

  const vazbyByRocnik: Record<number, SvpVazba[]> = {};
  for (const v of zaznam.svp_vazby) {
    if (!vazbyByRocnik[v.rocnik]) vazbyByRocnik[v.rocnik] = [];
    vazbyByRocnik[v.rocnik].push(v);
  }
  const rocniky = Object.keys(vazbyByRocnik).map(Number).sort((a, b) => a - b);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/tridni-kniha" className="hover:text-gray-600">
          Třídní kniha
        </Link>
        <span>/</span>
        <span className="text-gray-600">{zaznam.nazev}</span>
      </nav>

      {/* Hlavička záznamu */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-gray-400 mb-1 capitalize">
              {formatDatumFull(zaznam.datum)}
            </div>
            <h1 className="text-xl font-semibold text-gray-900">{zaznam.nazev}</h1>
          </div>

          <div className="flex items-center gap-2 ml-4">
            <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
              {TYP_LABELS[zaznam.typ_zaznamu] ?? zaznam.typ_zaznamu}
            </span>
            {isLocked && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
                </svg>
                Zamčeno
              </span>
            )}
          </div>
        </div>

        {/* Čas */}
        {zaznam.cas_od && (
          <div className="mt-3 text-sm text-gray-500">
            ⬱ {zaznam.cas_od.slice(0, 5)}{zaznam.cas_do ? ` – ${zaznam.cas_do.slice(0, 5)}` : ''}
          </div>
        )}

        {/* Popis */}
        {zaznam.popis && (
          <p className="mt-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {zaznam.popis}
          </p>
        )}

        {/* Metadata */}
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
          <span>Školní rok {zaznam.school_year}</span>
          <span>Vytvořeno {format(new Date(zaznam.created_at), 'd. M. yyyy HH:mm', { locale: cs })}</span>
        </div>
      </div>

      {/* Akce */}
      {!isLocked && (
        <div className="flex items-center gap-2 mb-6">
          <Link
            href={`/dashboard/tridni-kniha/${zaznam.id}/upravit`}
            className="inline-flex items-center gap-1.5 text-sm text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Upravit
          </Link>
        </div>
      )}

      {isLocked && (
        <div className="mb-6 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
          </svg>
          Školní rok {zaznam.school_year} je zamčen. Editace vyžaduje uvedení důvodu změny.
        </div>
      )}

      {/* Průběh dne — obsah zapsaný po blocích v „Zápisu dne" */}
      {bloky.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Průběh dne
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {bloky.map((b, i) => (
              <div key={i} className="px-6 py-4 flex gap-4">
                <div className="w-24 shrink-0 text-xs text-gray-400 pt-0.5">
                  {b.cas_od.slice(0, 5)}–{b.cas_do.slice(0, 5)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{b.nazev}</div>
                  {b.obsah?.trim() ? (
                    <p className="mt-1 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {b.obsah}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-300 italic">bez zápisu</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SVP vazby */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            SVP vazby
          </h2>
          {!isLocked && (
            <Link
              href={`/dashboard/tridni-kniha/${zaznam.id}/svp`}
              className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Přidat / upravit
            </Link>
          )}
        </div>

        {rocniky.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Žádné SVP vazby. Přidejte propojení s výstupy ŠVP pro tento den.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {rocniky.map((rocnik) => (
              <div key={rocnik} className="px-6 py-4">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  {rocnik}. ročník
                </div>
                <div className="space-y-2">
                  {vazbyByRocnik[rocnik].map((v) => (
                    <div key={v.id} className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 text-xs font-mono text-gray-400 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">
                        {v.svp_vystupy.kod}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-400">{v.svp_vystupy.predmet}</div>
                        <div className="text-sm text-gray-700">{v.svp_vystupy.vystup_text}</div>
                      </div>
                      {v.zdroj === 'ai' && (
                        <span className="shrink-0 text-xs text-gray-400 bg-gray-50 rounded px-1.5 py-0.5 border border-gray-100">
                          AI
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
