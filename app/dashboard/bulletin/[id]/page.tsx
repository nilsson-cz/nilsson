import DeleteButton from './_DeleteButton';
// app/bulletin/[id]/page.tsx
// Detail příspěvku nástěnky

import Link             from 'next/link';
import { notFound }     from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
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
// Statistika emailů – podkomponenta
// ─────────────────────────────────────────────────────────────

function EmailStats({
  sentCount,
  deliveredCount,
  bouncedCount,
  complainedCount,
}: {
  sentCount:       number;
  deliveredCount:  number;
  bouncedCount:    number;
  complainedCount: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Odesláno',   value: sentCount,       color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
        { label: 'Doručeno',   value: deliveredCount,  color: 'text-blue-700    bg-blue-50    border-blue-200'    },
        { label: 'Bounced',    value: bouncedCount,    color: 'text-amber-700   bg-amber-50   border-amber-200'   },
        { label: 'Stížnosti',  value: complainedCount, color: 'text-red-700     bg-red-50     border-red-200'     },
      ].map(stat => (
        <div key={stat.label} className={`rounded-lg border px-4 py-3 text-center ${stat.color}`}>
          <p className="text-2xl font-bold">{stat.value}</p>
          <p className="text-xs font-medium mt-0.5">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Otevřeno po třídách – podkomponenta
// ─────────────────────────────────────────────────────────────

interface ReadRow {
  class_id:     string;
  class_name:   string;
  student_id:   string;
  student_name: string;
  opened:       boolean;
}

function ReadByClass({ rows }: { rows: ReadRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-stone-400 italic">
        Přehled po třídách je dostupný jen pro zprávy odeslané po zavedení této funkce.
      </p>
    );
  }

  // Grupování po třídách (řazení už zajišťuje RPC)
  const byClass = new Map<string, { name: string; students: ReadRow[] }>();
  for (const r of rows) {
    if (!byClass.has(r.class_id)) byClass.set(r.class_id, { name: r.class_name, students: [] });
    byClass.get(r.class_id)!.students.push(r);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-1.5">
        <h3 className="text-sm font-semibold text-stone-700">Otevřeno (orientační)</h3>
        <span
          className="text-stone-400 cursor-help text-xs mt-0.5"
          title="Údaj z e-mailového klienta zákonného zástupce. Nemusí odpovídat skutečnému přečtení – některé aplikace obrázky (a tím sledovací pixel) přednačítají nebo naopak blokují."
        >
          ⓘ
        </span>
      </div>

      {[...byClass.values()].map(cls => {
        const openedCount = cls.students.filter(s => s.opened).length;
        return (
          <div key={cls.name} className="rounded-lg border border-stone-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-stone-100">
              <span className="text-sm font-medium text-stone-700">{cls.name}</span>
              <span className="text-xs text-stone-500">
                {openedCount} / {cls.students.length} otevřelo
              </span>
            </div>
            <ul className="divide-y divide-stone-50">
              {cls.students.map(s => (
                <li key={s.student_id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  {s.opened ? (
                    <span className="text-emerald-600 shrink-0" aria-label="otevřeno">✅</span>
                  ) : (
                    <span
                      className="inline-block w-4 h-4 rounded-full border border-stone-300 shrink-0"
                      aria-label="neotevřeno"
                    />
                  )}
                  <span className={s.opened ? 'text-stone-800' : 'text-stone-400'}>
                    {s.student_name}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Stránka
// ─────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BulletinDetailPage({ params }: PageProps) {
  const resolvedParams = await params;
  const supabase = await createSupabaseServerClient();

  // Načteme post
  const { data: post, error } = await supabase
    .from('bulletin_posts')
    .select('*')
    .eq('id', resolvedParams.id)
    .single();

  if (error || !post) notFound();

  const { id: _id } = resolvedParams;
  const p = post as BulletinPostRow;
  const isEvent  = p.type === 'event';
  const isLocked = p.email_sent_at !== null;

  // Počet příjemců
  const { count: recipientCount } = await supabase
    .from('bulletin_post_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', p.id);

  // Statistiky emailů – SECURITY DEFINER RPC (obchází RLS v SSR kontextu)
  const { data: emailStats } = await supabase
    .rpc('get_bulletin_email_stats', { p_post_id: p.id });

  const stats = ((emailStats as { event_type: string; cnt: number }[]) ?? [])
    .reduce<Record<string, number>>((acc, ev) => {
      acc[ev.event_type] = (acc[ev.event_type] ?? 0) + Number(ev.cnt);
      return acc;
    }, {});

  // Přehled otevření po třídách – jen pro odeslané zprávy
  const { data: readRows } = p.email_sent_at
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase as any).rpc('get_bulletin_read_by_class', { p_post_id: p.id })
    : { data: [] };

  // Autor
  const { data: author } = await supabase
    .from('staff')
    .select('first_name, last_name')
    .eq('id', p.author_id)
    .single();

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* ── Breadcrumb ── */}
      <div className="mb-6 flex items-center justify-between">
        <Link href="/dashboard/bulletin" className="text-sm text-stone-500 hover:text-stone-700">
          ← Nástěnka
        </Link>

        <div className="flex items-center gap-2">
          {isLocked ? (
            <span className="text-xs text-stone-400 flex items-center gap-1">
              🔒 Uzamčeno po odeslání
            </span>
          ) : (
            <Link
              href={`/dashboard/bulletin/${p.id}/edit`}
              className="text-sm text-emerald-600 hover:text-emerald-800 font-medium transition-colors"
            >
              ✏️ Upravit
            </Link>
          )}
        </div>
      </div>

      {/* ── Hlavička ── */}
      <div className="mb-6">
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full mb-3
          ${isEvent
            ? 'bg-blue-50 text-blue-700 border border-blue-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}
        >
          {isEvent ? '📅 Akce' : '📋 Zpráva'}
        </span>

        <h1 className="text-2xl font-bold text-stone-800 leading-snug">
          {p.title}
        </h1>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-500">
          {author && (
            <span>👤 {author.first_name} {author.last_name}</span>
          )}
          <span>📅 Platné {formatDate(p.valid_from)} – {formatDate(p.valid_until)}</span>
        </div>
      </div>

      {/* ── Blok akce ── */}
      {isEvent && (p.event_date || p.event_location) && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          {p.event_date && (
            <p className="text-blue-800 font-semibold">
              🗓 {formatDatetime(p.event_date)}
            </p>
          )}
          {p.event_location && (
            <p className="text-blue-700 mt-1">
              📍 {p.event_location}
            </p>
          )}
        </div>
      )}

      {/* ── Obsah ── */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
        {/* Jednoduchý Markdown render – pro produkci použij next-mdx-remote nebo remark */}
        <div className="prose prose-stone prose-sm max-w-none">
          <pre className="whitespace-pre-wrap text-sm text-stone-700 font-sans leading-relaxed">
            {p.body}
          </pre>
        </div>
      </div>

      {/* ── Statistika ── */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-stone-700">
          Statistika doručení
        </h2>

        <div className="flex items-center gap-3 text-sm text-stone-600">
          <span className="font-medium">Příjemci:</span>
          <span>{recipientCount ?? 0} zákonných zástupců</span>
        </div>

        {p.email_sent_at ? (
          <>
            <p className="text-sm text-stone-500">
              E-maily odeslány: <strong>{formatDatetime(p.email_sent_at)}</strong>
            </p>
            <EmailStats
              sentCount={stats['sent'] ?? 0}
              deliveredCount={stats['delivered'] ?? 0}
              bouncedCount={stats['bounced'] ?? 0}
              complainedCount={stats['complained'] ?? 0}
            />

            <div className="pt-2">
              <ReadByClass rows={(readRows as ReadRow[]) ?? []} />
            </div>
          </>
        ) : (
          <p className="text-sm text-stone-400 italic">
            E-mail nebyl odeslán.
          </p>
        )}
      </div>

      {/* ── Soft delete / archivace ── */}
      <div className="mt-10 pt-6 border-t border-stone-100">
        <p className="text-xs text-stone-400 mb-2">
          Smazáním se příspěvek skryje z nástěnky (nastaví platnost do včera).
        </p>
        <DeleteButton postId={p.id} />
      </div>

    </div>
  );
}
