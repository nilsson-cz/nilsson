// app/dashboard/tridni-kniha/chybejici/page.tsx
// Server Component — seznam pracovních dní bez záznamu v třídní knize

import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { CURRENT_SCHOOL_YEAR } from '@/lib/config';
import { getMissingTKDays, formatDateCZ } from '@/lib/tridni-kniha-missing';
import { getHolidayDateSet } from '@/lib/school-calendar-server';

export default async function ChybejiciDnyPage() {
  const supabase = await createSupabaseServerClient();

  const [{ data: skupiny }, holidayDays] = await Promise.all([
    supabase.from('groups').select('id, name').eq('school_year', CURRENT_SCHOOL_YEAR).order('name'),
    getHolidayDateSet(CURRENT_SCHOOL_YEAR),
  ]);

  const skupinyData = await Promise.all(
    (skupiny ?? []).map(async (skupina) => {
      const { data: zaznamy } = await supabase
        .from('tridni_kniha_zaznamy')
        .select('datum')
        .eq('school_year', CURRENT_SCHOOL_YEAR)
        .eq('group_id', skupina.id);

      const existujiciDny = new Set((zaznamy ?? []).map((z: any) => z.datum as string));
      const chybejici = getMissingTKDays(CURRENT_SCHOOL_YEAR, existujiciDny, holidayDays);

      return { skupina, chybejici };
    })
  );

  const celkemChybejici = skupinyData.reduce((sum, s) => sum + s.chybejici.length, 0);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/tridni-kniha" className="hover:text-gray-600">Třídní kniha</Link>
        <span>/</span>
        <span className="text-gray-600">Nedoplněné dny</span>
      </nav>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Nedoplněné dny</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Školní rok {CURRENT_SCHOOL_YEAR} · pracovní dny bez záznamu
          </p>
        </div>
        {celkemChybejici === 0 && (
          <span className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
            Vše doplněno ✓
          </span>
        )}
      </div>

      {skupinyData.length === 0 && (
        <div className="text-sm text-gray-400 py-8 text-center">
          Pro školní rok {CURRENT_SCHOOL_YEAR} nejsou definované žádné třídy.
        </div>
      )}

      <div className="space-y-6">
        {skupinyData.map(({ skupina, chybejici }) => (
          <div key={skupina.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                Třída {skupina.name}
              </h2>
              <span className="text-xs text-gray-400">
                {chybejici.length === 0
                  ? 'vše doplněno'
                  : `${chybejici.length} ${chybejici.length === 1 ? 'den' : chybejici.length < 5 ? 'dny' : 'dní'}`}
              </span>
            </div>

            {chybejici.length === 0 ? (
              <div className="px-6 py-6 text-center text-sm text-gray-400">
                Žádné nedoplněné dny.
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {chybejici.map((datum) => (
                  <div key={datum} className="flex items-center justify-between px-6 py-3">
                    <span className="text-sm text-gray-700">
                      {formatDateCZ(datum)}
                    </span>
                    <Link
                      href={`/dashboard/tridni-kniha/novy?datum=${datum}&group_id=${skupina.id}`}
                      className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Doplnit
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}


