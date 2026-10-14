// app/dashboard/tridni-kniha/_components/HledaniVysledky.tsx
// Výsledky vyhledávání v třídnici (RPC hledej_v_tridnici, migrace 153).
// Server Component — dny se shodou + úryvky se zvýrazněním.

import Link from 'next/link';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { slovaDotazu, uryvek } from '@/lib/tridni-kniha-hledani';

export type HledaniRadek = {
  zaznam_id: string;
  datum: string;
  den_v_tydnu: string;
  school_year: string;
  group_id: string | null;
  nazev: string;
  typ_zaznamu: string;
  shody: { zdroj: 'den' | 'blok' | 'svp'; cas_od: string | null; nadpis: string | null; text: string | null }[];
};

const LIMIT = 200;

function Zvyrazni({ text, slova }: { text: string; slova: string[] }) {
  return (
    <>
      {uryvek(text, slova).map((u, i) =>
        u.shoda
          ? <mark key={i} className="bg-yellow-100 text-gray-900 rounded-sm px-0.5">{u.text}</mark>
          : <span key={i}>{u.text}</span>,
      )}
    </>
  );
}

export default function HledaniVysledky({
  q,
  radky,
  groupName,
  vseRoky,
}: {
  q: string;
  radky: HledaniRadek[];
  groupName: Map<string, string>;
  vseRoky: boolean;
}) {
  const slova = slovaDotazu(q);

  if (radky.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-sm">Nic nenalezeno pro „{q}“</p>
        {!vseRoky && <p className="text-xs mt-1">Zkuste hledat ve všech školních letech.</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="text-sm text-gray-500 mb-3">
        {radky.length >= LIMIT ? `Zobrazeno prvních ${LIMIT} dnů` : `Nalezeno ${radky.length} ${radky.length === 1 ? 'den' : radky.length < 5 ? 'dny' : 'dnů'}`}
      </div>
      <div className="space-y-2">
        {radky.map((r) => {
          // Text dne (název) je v hlavičce — samotnou shodu jen v názvu dne nevypisovat znovu.
          const casti = r.shody.filter((s) => (s.zdroj === 'den' ? s.text?.trim() : true));
          return (
            <Link
              key={r.zaznam_id}
              href={`/dashboard/tridni-kniha/${r.zaznam_id}`}
              className="block p-3 rounded-lg border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-all"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-900 shrink-0">
                  {format(new Date(r.datum + 'T12:00:00'), 'd. M. yyyy', { locale: cs })}
                </span>
                <span className="text-gray-400 text-xs uppercase">{r.den_v_tydnu}</span>
                {r.group_id && groupName.get(r.group_id) && (
                  <span className="shrink-0 text-xs font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                    {groupName.get(r.group_id)}
                  </span>
                )}
                {vseRoky && <span className="text-xs text-gray-400">{r.school_year}</span>}
                <span className="text-gray-700 truncate">
                  <Zvyrazni text={r.nazev} slova={slova} />
                </span>
              </div>

              {casti.length > 0 && (
                <div className="mt-2 space-y-1">
                  {casti.slice(0, 4).map((s, i) => (
                    <div key={i} className="text-sm text-gray-600 pl-3 border-l-2 border-gray-100">
                      <span className="text-xs text-gray-400 mr-1.5">
                        {s.zdroj === 'blok' && `${s.cas_od?.slice(0, 5) ?? ''} ${s.nadpis ?? ''}`}
                        {s.zdroj === 'svp' && <span className="font-mono">ŠVP {s.nadpis}</span>}
                        {s.zdroj === 'den' && 'Popis dne'}
                      </span>
                      {s.text?.trim()
                        ? <Zvyrazni text={s.text} slova={slova} />
                        : <span className="text-xs text-gray-300 italic">bez zápisu</span>}
                    </div>
                  ))}
                  {casti.length > 4 && (
                    <div className="text-xs text-gray-400 pl-3">a další shody ({casti.length - 4})</div>
                  )}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
