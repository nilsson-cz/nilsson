import { createSupabaseServerClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';

type BulletinPost = {
  id: string;
  title: string | null;
  body: string;
  type: string;
  valid_from: string | null;
  valid_until: string | null;
  event_date: string | null;       // TIMESTAMPTZ
  event_location: string | null;
  email_sent_at: string;           // TIMESTAMPTZ
  school_year: string;
};

const TYPE_LABELS: Record<string, string> = {
  info:     'Informace',
  event:    'Akce',
  urgent:   'Důležité',
  reminder: 'Připomínka',
};

const TYPE_COLORS: Record<string, string> = {
  info:     'bg-blue-50 text-blue-700 border-blue-200',
  event:    'bg-green-50 text-green-700 border-green-200',
  urgent:   'bg-red-50 text-red-700 border-red-200',
  reminder: 'bg-amber-50 text-amber-700 border-amber-200',
};

const TYPE_BAR: Record<string, string> = {
  info:     'bg-blue-400',
  event:    'bg-green-400',
  urgent:   'bg-red-400',
  reminder: 'bg-amber-400',
};

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return format(new Date(dateStr), 'd. MMMM yyyy', { locale: cs });
  } catch {
    return dateStr;
  }
}

export default async function ZpravyPage() {
  const supabase = await createSupabaseServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/portal/prihlaseni');

  // RPC místo .from() — kanonický vzor pro guardian přístup
  // (PostgREST .from() nepředává JWT správně pro guardian RLS politiky)
  
  const { data: posts, error } = await supabase.rpc('get_bulletin_for_guardian', {
    p_school_year: undefined,
  });

  if (error) {
    console.error('[/portal/zpravy] RPC error:', error);
  }

  const bulletinPosts: BulletinPost[] = (posts as BulletinPost[] | null) ?? [];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Hlavička */}
      <div className="bg-white border-b border-gray-200 px-4 py-5">
        <h1 className="text-xl font-semibold text-gray-900">Zprávy ze školy</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Oznámení a informace určené vaší rodině
        </p>
      </div>

      <div className="px-4 py-4">
        {/* Chyba */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-medium">Nepodařilo se načíst zprávy</p>
            <p className="mt-1 text-red-600">{error.message}</p>
          </div>
        )}

        {/* Prázdný stav */}
        {!error && bulletinPosts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-gray-500 font-medium">Žádné zprávy</p>
            <p className="mt-1 text-sm text-gray-400">
              Zprávy ze školy se zobrazí zde po odeslání.
            </p>
          </div>
        )}

        {/* Seznam zpráv */}
        {bulletinPosts.length > 0 && (
          <ul className="space-y-3">
            {bulletinPosts.map((post) => {
              const typeLabel = TYPE_LABELS[post.type] ?? post.type;
              const typeColor = TYPE_COLORS[post.type] ?? 'bg-gray-50 text-gray-600 border-gray-200';
              const typeBar   = TYPE_BAR[post.type]   ?? 'bg-gray-300';
              const sentDate  = formatDate(post.email_sent_at);
              const eventDate = formatDate(post.event_date);

              return (
                <li
                  key={post.id}
                  className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
                >
                  {/* Barevný pruh nahoře dle typu */}
                  <div className={`h-1 w-full ${typeBar}`} />

                  <div className="p-4">
                    {/* Záhlaví: typ + datum odeslání */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${typeColor}`}>
                        {typeLabel}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {sentDate}
                      </span>
                    </div>

                    {/* Nadpis */}
                    {post.title && (
                      <h2 className="text-base font-semibold text-gray-900 mb-2 leading-snug">
                        {post.title}
                      </h2>
                    )}

                    {/* Tělo zprávy */}
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {post.body}
                    </p>

                    {/* Datum + místo akce */}
                    {(eventDate || post.event_location) && (
                      <div className="mt-3 space-y-1">
                        {eventDate && (
                          <div className="flex items-center gap-1.5 text-sm text-green-700">
                            <span>📅</span>
                            <span>Datum akce: <strong>{eventDate}</strong></span>
                          </div>
                        )}
                        {post.event_location && (
                          <div className="flex items-center gap-1.5 text-sm text-green-700">
                            <span>📍</span>
                            <span>{post.event_location}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Platnost do */}
                    {post.valid_until && (
                      <div className="mt-2 text-xs text-gray-400">
                        Platí do: {formatDate(post.valid_until)}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
