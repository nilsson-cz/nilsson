'use client';

// app/bulletin/new/page.tsx
// Formulář pro vytvoření nového příspěvku nástěnky.
// Client component – potřebujeme interaktivitu (type switcher, recipient preview, atd.)

import { useState, useEffect, useCallback } from 'react';
import { useRouter }    from 'next/navigation';
import type { RecipientPreview, StaffRecipientPreview } from '@/lib/bulletin/recipients';
import { markdownToHtml } from '@/app/zivot/_lib/markdown-to-html';

// ─────────────────────────────────────────────────────────────
// Typy
// ─────────────────────────────────────────────────────────────

interface Group {
  id:   string;
  name: string;
}

interface RecipientResponse {
  recipients:          RecipientPreview[];
  total_count:         number;
  missing_email_count: number;
  has_email_count:     number;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function toDateValue(date: Date): string {
  return date.toISOString().split('T')[0];
}

function today(): string  { return toDateValue(new Date()); }
function in14days(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return toDateValue(d);
}

// ─────────────────────────────────────────────────────────────
// Komponenta
// ─────────────────────────────────────────────────────────────

export default function BulletinNewPage() {
  const router = useRouter();

  // ── Formulářový stav ──
  const [type,          setType]          = useState<'message' | 'event'>('message');
  const [title,         setTitle]         = useState('');
  const [body,          setBody]          = useState('');
  const [validFrom,     setValidFrom]     = useState(today());
  const [validUntil,    setValidUntil]    = useState(in14days());
  const [eventDate,     setEventDate]     = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [sendEmail,     setSendEmail]     = useState(false);

  // ── Skupiny ──
  const [groups,         setGroups]         = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  // ── Zaměstnanci ──
  const [staff,         setStaff]         = useState<StaffRecipientPreview[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());

  // ── Příjemci ──
  const [recipients,         setRecipients]         = useState<RecipientPreview[]>([]);
  const [excludedGuardians,  setExcludedGuardians]  = useState<Set<string>>(new Set());
  const [loadingRecipients,  setLoadingRecipients]  = useState(false);

  // ── Submit ──
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // ── Markdown preview ──
  const [showPreview, setShowPreview] = useState(false);

  // Načteme skupiny
  useEffect(() => {
    fetch('/api/groups')
      .then(r => r.json())
      .then(data => setGroups(Array.isArray(data) ? data : []))
      .catch(err => console.error('Skupiny:', err));
  }, []);

  // Načteme aktivní zaměstnance
  useEffect(() => {
    fetch('/api/bulletin/staff')
      .then(r => r.json())
      .then(data => setStaff(Array.isArray(data?.staff) ? data.staff : []))
      .catch(err => console.error('Zaměstnanci:', err));
  }, []);

  // Načteme příjemce při změně vybraných skupin
  const fetchRecipients = useCallback(async () => {
    if (selectedGroups.size === 0) {
      setRecipients([]);
      return;
    }

    setLoadingRecipients(true);
    try {
      const groupIds  = Array.from(selectedGroups);
      const primary   = groupIds[0];
      const extra     = groupIds.slice(1).join(',');

      // Náhled vždy tahá CELÝ roster tříd — vyloučení neřešíme na serveru, jinak
      // by odznačený rodič ze seznamu zmizel a nešlo by ho znovu zaškrtnout.
      // Vyloučení je čistě klientské (excludedGuardians) a promítne se až v submitu.
      const url = new URL(
        `/api/bulletin/groups/${primary}/parents`,
        window.location.origin,
      );
      if (extra) url.searchParams.set('extra_group_ids', extra);

      const res:  RecipientResponse = await fetch(url.toString()).then(r => r.json());

      setRecipients(res.recipients ?? []);
    } catch (err) {
      console.error('Příjemci:', err);
    } finally {
      setLoadingRecipients(false);
    }
  }, [selectedGroups]);

  useEffect(() => {
    fetchRecipients();
  }, [fetchRecipients]);

  // ── Toggley ──
  function toggleGroup(id: string) {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    // Reset vyloučených při změně skupin
    setExcludedGuardians(new Set());
  }

  function toggleExclude(guardianId: string) {
    setExcludedGuardians(prev => {
      const next = new Set(prev);
      next.has(guardianId) ? next.delete(guardianId) : next.add(guardianId);
      return next;
    });
  }

  function toggleStaff(staffId: string) {
    setSelectedStaff(prev => {
      const next = new Set(prev);
      next.has(staffId) ? next.delete(staffId) : next.add(staffId);
      return next;
    });
  }

  const allStaffSelected = staff.length > 0 && selectedStaff.size === staff.length;

  function toggleAllStaff() {
    setSelectedStaff(allStaffSelected ? new Set() : new Set(staff.map(s => s.staff_id)));
  }

  // Hromadné odznačení / označení RODIČŮ v načteném rosteru.
  // Umožní „odznačit všechny → zaškrtnout jen pár" bez proklikávání desítek lidí
  // a bez vyklikávání celé třídy (ta zůstane vybraná, seznam rodičů viditelný).
  const noneRecipientsSelected =
    recipients.length > 0 && recipients.every(r => excludedGuardians.has(r.guardian_id));

  function toggleAllRecipients() {
    setExcludedGuardians(
      noneRecipientsSelected ? new Set() : new Set(recipients.map(r => r.guardian_id)),
    );
  }

  // ── Submit ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim())  { setError('Vyplňte název příspěvku.'); return; }
    if (!body.trim())   { setError('Vyplňte obsah příspěvku.'); return; }
    if (type === 'event' && !eventDate) {
      setError('U akce vyplňte datum a čas konání.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/bulletin/posts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title:                 title.trim(),
          body,
          valid_from:            validFrom,
          valid_until:           validUntil,
          event_date:            type === 'event' ? eventDate : null,
          event_location:        type === 'event' ? eventLocation : null,
          send_email:            sendEmail,
          group_ids:             Array.from(selectedGroups),
          excluded_guardian_ids: Array.from(excludedGuardians),
          staff_ids:             Array.from(selectedStaff),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const post = await res.json();
      router.push(`/dashboard/bulletin/${post.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Odeslání selhalo');
    } finally {
      setSubmitting(false);
    }
  }

  const effectiveRecipients = recipients.filter(r => !excludedGuardians.has(r.guardian_id));
  // Chybějící e-maily počítáme jen z reálně vybraných (vyloučení je klientské).
  const effectiveMissingEmailCount = effectiveRecipients.filter(r => !r.hasEmail).length;

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <a href="/dashboard/bulletin" className="text-sm text-stone-500 hover:text-stone-700">
          ← Zpět na nástěnku
        </a>
        <h1 className="text-2xl font-bold text-stone-800 mt-2">Nový příspěvek</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Type switcher ── */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-2">
            Typ příspěvku
          </label>
          <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden">
            {(['message', 'event'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`px-5 py-2 text-sm font-medium transition-colors
                  ${type === t
                    ? t === 'event'
                      ? 'bg-blue-600 text-white'
                      : 'bg-emerald-600 text-white'
                    : 'bg-white text-stone-600 hover:bg-stone-50'
                  }`}
              >
                {t === 'message' ? '📋 Zpráva' : '📅 Akce'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Název ── */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Název <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={type === 'event' ? 'Výlet do přírody' : 'Informace o třídní schůzce'}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            required
          />
        </div>

        {/* ── Obsah (Markdown) ── */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-stone-700">
              Obsah <span className="text-red-500">*</span>
              <span className="text-stone-400 font-normal ml-1">(Markdown)</span>
            </label>
            <button
              type="button"
              onClick={() => setShowPreview(p => !p)}
              className="text-xs text-stone-500 hover:text-emerald-600 transition-colors"
            >
              {showPreview ? 'Editovat' : 'Náhled'}
            </button>
          </div>

          {showPreview ? (
            <div
              className="min-h-[140px] rounded-lg border border-stone-200 px-4 py-3 prose prose-sm
                         prose-stone max-w-none bg-stone-50"
              // Stejný renderer jako ostrý e-mail/zeď (marked, gfm + breaks),
              // ať náhled 1:1 odpovídá odeslané zprávě. Obsah je autorův vlastní.
              dangerouslySetInnerHTML={{
                __html: body.trim()
                  ? markdownToHtml(body)
                  : '<span class="text-stone-400">Žádný obsah.</span>',
              }}
            />
          ) : (
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              placeholder="Napište obsah příspěvku ve formátu Markdown…"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              required
            />
          )}
        </div>

        {/* ── Platnost ── */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Platné od <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={validFrom}
              onChange={e => setValidFrom(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Platné do <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={validUntil}
              onChange={e => setValidUntil(e.target.value)}
              min={validFrom}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500"
              required
            />
          </div>
        </div>

        {/* ── Pole akce ── */}
        {type === 'event' && (
          <div className="grid grid-cols-2 gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100">
            <div className="col-span-2 text-sm font-medium text-blue-700 mb-1">
              📅 Detaily akce
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Datum a čas akce <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={type === 'event'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Místo konání
              </label>
              <input
                type="text"
                value={eventLocation}
                onChange={e => setEventLocation(e.target.value)}
                placeholder="Botanická zahrada Teplice"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {/* ── Skupiny ── */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-2">
            Skupiny příjemců
          </label>
          {groups.length === 0 ? (
            <p className="text-sm text-stone-400">Načítání skupin…</p>
          ) : (
            <div className="space-y-2">
              {groups.map(group => (
                <label
                  key={group.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                    ${selectedGroups.has(group.id)
                      ? 'border-emerald-400 bg-emerald-50'
                      : 'border-stone-200 bg-white hover:bg-stone-50'
                    }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedGroups.has(group.id)}
                    onChange={() => toggleGroup(group.id)}
                    className="rounded text-emerald-600"
                  />
                  <span className="text-sm font-medium text-stone-700">
                    {group.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ── Zaměstnanci ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-stone-700">
              Zaměstnanci
              {staff.length > 0 && (
                <span className="text-stone-400 font-normal ml-1">
                  ({selectedStaff.size} z {staff.length})
                </span>
              )}
            </label>
            {staff.length > 0 && (
              <button
                type="button"
                onClick={toggleAllStaff}
                className="text-xs text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                {allStaffSelected ? 'Odznačit všechny' : 'Všichni zaměstnanci'}
              </button>
            )}
          </div>

          {staff.length === 0 ? (
            <p className="text-sm text-stone-400">Načítání zaměstnanců…</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto rounded-lg border border-stone-200 p-2">
              {staff.map(s => {
                const checked = selectedStaff.has(s.staff_id);
                return (
                  <label
                    key={s.staff_id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors
                      ${checked ? 'bg-emerald-50' : 'hover:bg-stone-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStaff(s.staff_id)}
                      className="rounded text-emerald-600"
                    />
                    <span className="text-sm text-stone-700 flex-1">
                      {s.first_name} {s.last_name}
                    </span>
                    {s.hasEmail ? (
                      <span className="text-xs text-stone-400">{s.email}</span>
                    ) : (
                      <span className="text-xs text-amber-600">bez e-mailu</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Příjemci ── */}
        {selectedGroups.size > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-stone-700">
                Příjemci
                {!loadingRecipients && (
                  <span className="text-stone-400 font-normal ml-1">
                    ({effectiveRecipients.length} z {recipients.length})
                  </span>
                )}
              </label>
              {loadingRecipients ? (
                <span className="text-xs text-stone-400 animate-pulse">Načítám…</span>
              ) : recipients.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllRecipients}
                  className="text-xs text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  {noneRecipientsSelected ? 'Vybrat všechny' : 'Odznačit všechny'}
                </button>
              )}
            </div>

            {/* ⚠️ Upozornění na chybějící emaily */}
            {effectiveMissingEmailCount > 0 && (
              <div className="mb-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <span className="text-base">⚠️</span>
                <span>
                  <strong>{effectiveMissingEmailCount}</strong>{' '}
                  {effectiveMissingEmailCount === 1
                    ? 'zákonný zástupce nemá'
                    : 'zákonní zástupci nemají'}{' '}
                  zadaný e-mail a neobdrží e-mailovou notifikaci.
                </span>
              </div>
            )}

            <div className="space-y-1 max-h-56 overflow-y-auto rounded-lg border border-stone-200 p-2">
              {recipients.map(r => {
                const excluded = excludedGuardians.has(r.guardian_id);
                return (
                  <label
                    key={r.guardian_id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors
                      ${excluded ? 'opacity-40 bg-stone-50' : 'hover:bg-stone-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={!excluded}
                      onChange={() => toggleExclude(r.guardian_id)}
                      className="rounded text-emerald-600"
                    />
                    <span className="text-sm text-stone-700 flex-1">
                      {r.first_name} {r.last_name}
                    </span>
                    {r.hasEmail ? (
                      <span className="text-xs text-stone-400">{r.email}</span>
                    ) : (
                      <span className="text-xs text-amber-600">bez e-mailu</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Odeslat emailem ── */}
        <label className="flex items-start gap-3 p-4 rounded-xl border border-stone-200 cursor-pointer
                           hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={e => setSendEmail(e.target.checked)}
            className="mt-0.5 rounded text-emerald-600"
          />
          <div>
            <p className="text-sm font-medium text-stone-700">
              Odeslat zákonným zástupcům e-mailem
            </p>
            <p className="text-xs text-stone-500 mt-0.5">
              Příspěvek bude po uložení zaslán všem vybraným příjemcům s platným e-mailem.
            </p>
          </div>
        </label>

        {/* ── Chyba ── */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── Submit ── */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50
                       text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-colors"
          >
            {submitting ? 'Ukládám…' : sendEmail ? 'Uložit a odeslat e-maily' : 'Uložit příspěvek'}
          </button>
          <a
            href="/dashboard/bulletin"
            className="px-5 py-2.5 rounded-lg border border-stone-200 text-sm text-stone-600
                       hover:bg-stone-50 transition-colors"
          >
            Zrušit
          </a>
        </div>

      </form>
    </div>
  );
}

