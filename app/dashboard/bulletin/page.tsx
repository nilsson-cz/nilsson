// app/bulletin/page.tsx
// Přehled nástěnky: sekce Zprávy + sekce Agenda (akce)

import Link             from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { CURRENT_SCHOOL_YEAR } from '@/lib/config';
import type { BulletinPostRow } from '@/types/bulletin';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString('cs-CZ', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────────
// Dílčí komponenty
// ─────────────────────────────────────────────────────────────

function PostCard({ post }: { post: BulletinPostRow }) {
  const isEvent = post.type === 'event';

  return (
    <Link
      href={`/dashboard/bulletin/${post.id}`}
      className="block group rounded-xl border border-stone-200 bg-white p-5 shadow-sm
                 hover:border-emerald-400 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full mb-2
            ${isEvent
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            {isEvent ? '📅 Akce' : '📋 Zpráva'}
          </span>

          <h3 className="font-semibold text-stone-800 text-base leading-snug group-hover:text-emerald-800 transition-colors">
            {post.title}
          </h3>

          {isEvent && post.event_date && (
            <p className="mt-1 text-sm text-blue-700 font-medium">
              {formatDatetime(post.event_date)}
              {post.event_location && (
                <span className="text-stone-500 font-normal ml-1">
                  · {post.event_location}
                </span>
              )}
            </p>
          )}

          <p className="mt-2 text-sm text-stone-500 line-clamp-2">
            {/* Stripped markdown preview */}
            {post.body.replace(/[#*_`~[\]()!|]/g, '').slice(0, 150)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-stone-400">
        <span>Platné do {formatDate(post.valid_until)}</span>
        {post.email_sent_at && (
          <span className="flex items-center gap-1 text-emerald-600">
            ✉ odesláno
          </span>
        )}
      </div>
    </Link>
  );
}

function AgendaRow({ post }: { post: BulletinPostRow }) {
  return (
    <Link
      href={`/dashboard/bulletin/${post.id}`}
      className="group flex gap-4 items-start py-3 border-b border-stone-100 last:border-0
                 hover:bg-stone-50 -mx-4 px-4 rounded-lg transition-colors"
    >
      {/* Datum badge */}
      <div className="flex-shrink-0 w-14 text-center bg-blue-50 border border-blue-100 rounded-lg py-2">
        <p className="text-xl font-bold text-blue-700 leading-none">
          {new Date(post.event_date!).getDate().toString().padStart(2, '0')}
        </p>
        <p className="text-xs text-blue-500 mt-0.5">
          {new Date(post.event_date!).toLocaleDateString('cs-CZ', { month: 'short' })}
        </p>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-stone-800 group-hover:text-emerald-800 transition-colors leading-snug">
          {post.title}
        </p>
        {post.event_location && (
          <p className="text-sm text-stone-500 mt-0.5">📍 {post.event_location}</p>
        )}
        <p className="text-xs text-stone-400 mt-1">
          {formatDatetime(post.event_date!)}
        </p>
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// Stránka
// ─────────────────────────────────────────────────────────────

export default async function BulletinPage() {
  const supabase = await createSupabaseServerClient();
  const today    = new Date().toISOString().split('T')[0];

  // Aktivní příspěvky (oba typy) – pro sekci Zprávy
  const { data: activePosts } = await supabase
    .from('bulletin_posts')
    .select('*')
    .eq('school_year', CURRENT_SCHOOL_YEAR)
    .lte('valid_from', today)
    .gte('valid_until', today)
    .order('created_at', { ascending: false });

  // Budoucí akce – pro Agendu
  const { data: upcomingEvents } = await supabase
    .from('bulletin_posts')
    .select('*')
    .eq('school_year', CURRENT_SCHOOL_YEAR)
    .eq('type', 'event')
    .gte('event_date', new Date().toISOString())
    .order('event_date', { ascending: true });

  const posts  = (activePosts    ?? []) as BulletinPostRow[];
  const events = (upcomingEvents ?? []) as BulletinPostRow[];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">

      {/* ── Hlavička ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Nástěnka</h1>
          <p className="text-sm text-stone-500 mt-1">{CURRENT_SCHOOL_YEAR}</p>
        </div>
        <Link
          href="/dashboard/bulletin/new"
          className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700
                     text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nový příspěvek
        </Link>
      </div>

      {/* ── Sekce: Zprávy a akce (aktivní) ── */}
      <section>
        <h2 className="text-lg font-semibold text-stone-700 mb-4 flex items-center gap-2">
          <span>📋</span> Aktuální příspěvky
          <span className="text-sm font-normal text-stone-400 ml-1">
            ({posts.length})
          </span>
        </h2>

        {posts.length === 0 ? (
          <p className="text-stone-400 text-sm py-6 text-center border border-dashed border-stone-200 rounded-xl">
            Žádné aktivní příspěvky.
          </p>
        ) : (
          <div className="space-y-3">
            {posts.map(post => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>

      {/* ── Sekce: Agenda (budoucí akce) ── */}
      <section>
        <h2 className="text-lg font-semibold text-stone-700 mb-4 flex items-center gap-2">
          <span>📅</span> Agenda akcí
          <span className="text-sm font-normal text-stone-400 ml-1">
            ({events.length})
          </span>
        </h2>

        {events.length === 0 ? (
          <p className="text-stone-400 text-sm py-6 text-center border border-dashed border-stone-200 rounded-xl">
            Žádné nadcházející akce.
          </p>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl px-4 py-2">
            {events.map(event => (
              <AgendaRow key={event.id} post={event} />
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
