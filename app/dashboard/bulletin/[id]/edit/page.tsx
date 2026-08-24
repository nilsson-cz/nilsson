// app/dashboard/bulletin/[id]/edit/page.tsx — PATCH
// Změna oproti originálu: skupiny se zobrazují s rokem ve jméně
// a načítají se z ACTIVE_SCHOOL_YEARS (přes výchozí /api/groups bez parametru).
// Zbytek souboru beze změny — nahradit pouze část useEffect "3. Skupiny + rodiče"
// a řádek v renderování záhlaví skupiny.

// ─── ZMĚNA 1: v useEffect, sekce "3. Skupiny + rodiče" ───────────────────────
//
// PŮVODNÍ:
//   const groupsRes = await fetch('/api/groups');
//   if (groupsRes.ok) {
//     const groupsData: { id: string; name: string }[] = await groupsRes.json();
//     const withParents: GroupWithParents[] = await Promise.all(
//       groupsData.map(async (g) => {
//         ...
//         return { groupId: g.id, groupName: g.name, parents };
//       }),
//     );
//
// NOVÉ — přidán school_year do typu a zobrazení:
//   const groupsRes = await fetch('/api/groups');   // výchozí = ACTIVE_SCHOOL_YEARS
//   if (groupsRes.ok) {
//     const groupsData: { id: string; name: string; school_year: string }[] = await groupsRes.json();
//     const withParents: GroupWithParents[] = await Promise.all(
//       groupsData.map(async (g) => {
//         ...
//         // Zobrazit "Beta (2026/2027)" nebo "I. (2025/2026)"
//         const label = `${g.name} (${g.school_year})`;
//         return { groupId: g.id, groupName: label, parents };
//       }),
//     );

// ─── ZMĚNA 2: typ GroupWithParents — přidat schoolYear ───────────────────────
//
// PŮVODNÍ:
//   type GroupWithParents = {
//     groupId:   string;
//     groupName: string;
//     parents:   Guardian[];
//   };
//
// NOVÉ:
//   type GroupWithParents = {
//     groupId:    string;
//     groupName:  string;   // již obsahuje rok: "Beta (2026/2027)"
//     schoolYear: string;
//     parents:    Guardian[];
//   };

// ─── KOMPLETNÍ OPRAVENÝ SOUBOR ────────────────────────────────────────────────
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams, useRouter } from 'next/navigation';

type PostType = 'message' | 'event';

type BulletinPost = {
  id: string;
  type: PostType;
  title: string;
  body: string;
  valid_from: string;
  valid_until: string;
  event_date: string | null;
  event_location: string | null;
  send_email: boolean;
  email_sent_at: string | null;
  school_year: string;
};

type Guardian = {
  guardian_id: string;
  first_name:  string;
  last_name:   string;
  email:       string | null;
  hasEmail:    boolean;
};

type Staff = {
  staff_id:   string;
  first_name: string;
  last_name:  string;
  email:      string | null;
  hasEmail:   boolean;
};

type GroupWithParents = {
  groupId:    string;
  groupName:  string;   // formát: "Beta (2026/2027)"
  schoolYear: string;
  parents:    Guardian[];
};

export default function BulletinEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [post, setPost]                   = useState<BulletinPost | null>(null);
  const [groups, setGroups]               = useState<GroupWithParents[]>([]);
  const [currentRecipients, setCurrentRecipients] = useState<Set<string>>(new Set());
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [staff, setStaff]                 = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());

  const [title, setTitle]                 = useState('');
  const [body, setBody]                   = useState('');
  const [type, setType]                   = useState<PostType>('message');
  const [validFrom, setValidFrom]         = useState('');
  const [validUntil, setValidUntil]       = useState('');
  const [eventDate, setEventDate]         = useState('');
  const [eventLocation, setEventLocation] = useState('');

  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [saveError, setSaveError]   = useState<string | null>(null);
  const [sendError, setSendError]   = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; missing_email: number } | null>(null);
  const [isSaving, startSave]       = useTransition();
  const [isSending, startSend]      = useTransition();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);

      try {
        const postRes = await fetch(`/api/bulletin/posts/${id}`);
        if (!postRes.ok) throw new Error('Příspěvek nenalezen');
        const postData: BulletinPost = await postRes.json();
        setPost(postData);
        setTitle(postData.title ?? '');
        setBody(postData.body ?? '');
        setType(postData.type ?? 'message');
        setValidFrom(postData.valid_from ?? '');
        setValidUntil(postData.valid_until ?? '');
        setEventDate(postData.event_date ? postData.event_date.split('T')[0] : '');
        setEventLocation(postData.event_location ?? '');

        const recipRes = await fetch(`/api/bulletin/posts/${id}/recipients`);
        let savedIds = new Set<string>();
        if (recipRes.ok) {
          const recipData: {
            guardians: { guardian_id: string }[];
            staff_ids: string[];
          } = await recipRes.json();
          savedIds = new Set((recipData.guardians ?? []).map(r => r.guardian_id));
          setCurrentRecipients(savedIds);
          setSelectedRecipients(new Set(savedIds));
          setSelectedStaff(new Set(recipData.staff_ids ?? []));
        }

        // Aktivní zaměstnanci pro picker
        const staffRes = await fetch('/api/bulletin/staff');
        if (staffRes.ok) {
          const staffData = await staffRes.json();
          setStaff(Array.isArray(staffData?.staff) ? staffData.staff : []);
        }

        // ZMĚNA: /api/groups bez parametru → ACTIVE_SCHOOL_YEARS (I. + Beta + Gamma)
        // Řazení: 2026/2027 první (server řadí school_year DESC, name ASC)
        const groupsRes = await fetch('/api/groups');
        if (groupsRes.ok) {
          const groupsData: { id: string; name: string; school_year: string }[] = await groupsRes.json();
          const withParents: GroupWithParents[] = await Promise.all(
            groupsData.map(async (g) => {
              const pRes = await fetch(`/api/bulletin/groups/${g.id}/parents`);
              let parents: Guardian[] = [];
              if (pRes.ok) {
                const pData = await pRes.json();
                const raw: Guardian[] = Array.isArray(pData) ? pData : (pData.recipients ?? []);
                parents = raw;
              }
              // "Beta (2026/2027)" nebo "I. (2025/2026)"
              const label = `${g.name} (${g.school_year})`;
              return { groupId: g.id, groupName: label, schoolYear: g.school_year, parents };
            }),
          );
          setGroups(withParents);

          const toExpand = new Set<string>();
          withParents.forEach(g => {
            if (g.parents.some(p => savedIds.has(p.guardian_id))) {
              toExpand.add(g.groupId);
            }
          });
          setExpandedGroups(toExpand);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Chyba při načítání');
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const isLocked = post?.email_sent_at != null;

  function toggleGroup(groupId: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  function toggleRecipient(guardianId: string) {
    if (isLocked) return;
    setSelectedRecipients(prev => {
      const next = new Set(prev);
      next.has(guardianId) ? next.delete(guardianId) : next.add(guardianId);
      return next;
    });
  }

  function selectAllInGroup(group: GroupWithParents) {
    if (isLocked) return;
    setSelectedRecipients(prev => {
      const next = new Set(prev);
      group.parents.forEach(p => next.add(p.guardian_id));
      return next;
    });
  }

  function deselectAllInGroup(group: GroupWithParents) {
    if (isLocked) return;
    setSelectedRecipients(prev => {
      const next = new Set(prev);
      group.parents.forEach(p => next.delete(p.guardian_id));
      return next;
    });
  }

  function toggleStaff(staffId: string) {
    if (isLocked) return;
    setSelectedStaff(prev => {
      const next = new Set(prev);
      next.has(staffId) ? next.delete(staffId) : next.add(staffId);
      return next;
    });
  }

  const allStaffSelected = staff.length > 0 && selectedStaff.size === staff.length;

  function toggleAllStaff() {
    if (isLocked) return;
    setSelectedStaff(allStaffSelected ? new Set() : new Set(staff.map(s => s.staff_id)));
  }

  // Zrušit výběr: vyprázdní celý výběr adresátů (ZZ i zaměstnanci).
  function clearSelection() {
    if (isLocked) return;
    setSelectedRecipients(new Set());
    setSelectedStaff(new Set());
  }

  function handleSave() {
    if (isLocked) return;
    setSaveError(null);

    startSave(async () => {
      try {
        const patchRes = await fetch(`/api/bulletin/posts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title:          title.trim(),
            body,
            valid_from:     validFrom,
            valid_until:    validUntil,
            event_date:     type === 'event' ? (eventDate || null) : null,
            event_location: type === 'event' ? (eventLocation.trim() || null) : null,
          }),
        });

        if (!patchRes.ok) {
          const err = await patchRes.json();
          throw new Error(err.error ?? 'Uložení selhalo');
        }

        const recipRes = await fetch(`/api/bulletin/posts/${id}/recipients`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guardian_ids: Array.from(selectedRecipients),
            staff_ids:    Array.from(selectedStaff),
          }),
        });

        if (!recipRes.ok) {
          const err = await recipRes.json();
          throw new Error(err.error ?? 'Aktualizace příjemců selhala');
        }

        router.push(`/dashboard/bulletin/${id}`);
        router.refresh();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Neznámá chyba');
      }
    });
  }

  function handleSend() {
    setSendError(null);
    setSendResult(null);

    startSend(async () => {
      try {
        const res = await fetch(`/api/bulletin/posts/${id}/send`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Odeslání selhalo');
        setSendResult(data);
        const postRes = await fetch(`/api/bulletin/posts/${id}`);
        if (postRes.ok) setPost(await postRes.json());
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Neznámá chyba');
      }
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Načítám…
      </div>
    );
  }

  if (loadError || !post) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError ?? 'Příspěvek nenalezen'}
        </div>
      </div>
    );
  }

  const allGuardians = groups.flatMap(g => g.parents);
  const uniqueGuardians = [...new Map(allGuardians.map(g => [g.guardian_id, g])).values()];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push(`/dashboard/bulletin/${id}`)}
            className="text-sm text-gray-400 hover:text-gray-600 mb-1 flex items-center gap-1 transition-colors"
          >
            ← zpět na detail
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            {isLocked ? 'Detail zprávy' : 'Upravit zprávu'}
          </h1>
        </div>
      </div>

      {isLocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">✉ Email byl odeslán</p>
          <p className="mt-0.5 text-amber-700">
            Odesláno: {new Date(post.email_sent_at!).toLocaleString('cs-CZ')}
            {' '}— formulář je uzamčen. Příjemce a obsah nelze měnit.
          </p>
        </div>
      )}

      {sendResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">✓ Odesláno</p>
          <p className="mt-0.5">
            Úspěšně: <strong>{sendResult.sent}</strong>
            {sendResult.failed > 0 && <> · Chyba: <strong className="text-red-600">{sendResult.failed}</strong></>}
            {sendResult.missing_email > 0 && <> · Bez emailu: <strong>{sendResult.missing_email}</strong></>}
          </p>
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        <h2 className="text-base font-semibold text-gray-800">Obsah zprávy</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Typ</label>
          <div className="flex gap-3">
            {(['message', 'event'] as PostType[]).map(t => (
              <button
                key={t}
                disabled={isLocked}
                onClick={() => setType(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  type === t
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {t === 'message' ? '💬 Zpráva' : '📅 Akce'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Nadpis <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={isLocked}
            placeholder="Název zprávy nebo akce"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Text zprávy <span className="text-red-400">*</span>
          </label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            disabled={isLocked}
            rows={6}
            placeholder="Text zprávy…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-500 resize-y"
          />
        </div>

        {type === 'event' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Datum akce</label>
              <input
                type="date"
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
                disabled={isLocked}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Místo konání</label>
              <input
                type="text"
                value={eventLocation}
                onChange={e => setEventLocation(e.target.value)}
                disabled={isLocked}
                placeholder="Např. tělocvična"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-500"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Platí od</label>
            <input
              type="date"
              value={validFrom}
              onChange={e => setValidFrom(e.target.value)}
              disabled={isLocked}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Platí do</label>
            <input
              type="date"
              value={validUntil}
              onChange={e => setValidUntil(e.target.value)}
              disabled={isLocked}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
        </div>

        {saveError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {saveError}
          </p>
        )}

        {!isLocked && (
          <button
            onClick={handleSave}
            disabled={isSaving || !title.trim() || !body.trim()}
            className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? 'Ukládám…' : 'Uložit změny'}
          </button>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Příjemci</h2>
          <div className="flex items-center gap-3">
            {!isLocked && (selectedRecipients.size > 0 || selectedStaff.size > 0) && (
              <button
                onClick={clearSelection}
                className="text-xs text-gray-400 hover:text-red-600 transition-colors"
              >
                Zrušit výběr
              </button>
            )}
            <span className="text-sm text-gray-400">
              {selectedRecipients.size + selectedStaff.size} vybráno
            </span>
          </div>
        </div>

        {groups.length === 0 && (
          <p className="text-sm text-gray-400">Načítám skupiny…</p>
        )}

        {groups.map(group => {
          const isExpanded      = expandedGroups.has(group.groupId);
          const selectedInGroup = group.parents.filter(p => selectedRecipients.has(p.guardian_id)).length;
          const allSelected     = group.parents.length > 0 && selectedInGroup === group.parents.length;

          return (
            <div key={group.groupId} className="border border-gray-100 rounded-lg overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer select-none hover:bg-gray-100 transition-colors"
                onClick={() => toggleGroup(group.groupId)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{isExpanded ? '▾' : '▸'}</span>
                  {/* groupName již obsahuje rok: "Beta (2026/2027)" */}
                  <span className="text-sm font-medium text-gray-800">{group.groupName}</span>
                  <span className="text-xs text-gray-400">
                    ({selectedInGroup}/{group.parents.length})
                  </span>
                </div>
                {!isLocked && (
                  <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => selectAllInGroup(group)}
                      disabled={allSelected}
                      className="text-xs text-orange-500 hover:text-orange-700 disabled:opacity-30 transition-colors"
                    >
                      vybrat vše
                    </button>
                    <span className="text-gray-300">·</span>
                    <button
                      onClick={() => deselectAllInGroup(group)}
                      disabled={selectedInGroup === 0}
                      className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                    >
                      odznačit vše
                    </button>
                  </div>
                )}
              </div>

              {isExpanded && (
                <ul className="divide-y divide-gray-50">
                  {group.parents.map(parent => {
                    const checked = selectedRecipients.has(parent.guardian_id);
                    return (
                      <li
                        key={parent.guardian_id}
                        onClick={() => toggleRecipient(parent.guardian_id)}
                        className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          isLocked ? 'cursor-default' : 'cursor-pointer hover:bg-orange-50'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          checked ? 'bg-orange-500 border-orange-500' : 'border-gray-300 bg-white'
                        }`}>
                          {checked && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                              <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <span className={checked ? 'text-gray-900' : 'text-gray-400'}>
                          {parent.first_name} {parent.last_name}
                        </span>
                        {!parent.hasEmail && (
                          <span className="ml-auto text-xs text-amber-500">bez emailu</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}

        {/* ── Zaměstnanci ── */}
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">Zaměstnanci</span>
              <span className="text-xs text-gray-400">
                ({selectedStaff.size}/{staff.length})
              </span>
            </div>
            {!isLocked && staff.length > 0 && (
              <button
                onClick={toggleAllStaff}
                className="text-xs text-orange-500 hover:text-orange-700 transition-colors"
              >
                {allStaffSelected ? 'odznačit vše' : 'vybrat všechny'}
              </button>
            )}
          </div>

          {staff.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">Načítám zaměstnance…</p>
          ) : (
            <ul className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
              {staff.map(s => {
                const checked = selectedStaff.has(s.staff_id);
                return (
                  <li
                    key={s.staff_id}
                    onClick={() => toggleStaff(s.staff_id)}
                    className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                      isLocked ? 'cursor-default' : 'cursor-pointer hover:bg-orange-50'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      checked ? 'bg-orange-500 border-orange-500' : 'border-gray-300 bg-white'
                    }`}>
                      {checked && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                          <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className={checked ? 'text-gray-900' : 'text-gray-400'}>
                      {s.first_name} {s.last_name}
                    </span>
                    {!s.hasEmail && (
                      <span className="ml-auto text-xs text-amber-500">bez emailu</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
        <h2 className="text-base font-semibold text-gray-800">Odeslat email</h2>

        {isLocked && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠ Email byl již odeslán dne {new Date(post.email_sent_at!).toLocaleString('cs-CZ')}.
            Odesláním znovu dostanou příjemci zprávu podruhé.
          </p>
        )}

        {sendError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {sendError}
          </p>
        )}

        <button
          onClick={handleSend}
          disabled={isSending}
          className="w-full rounded-lg border-2 border-orange-500 px-4 py-2.5 text-sm font-semibold text-orange-600 hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isSending
            ? 'Odesílám…'
            : isLocked
              ? '↺ Odeslat znovu všem příjemcům'
              : '✉ Odeslat email příjemcům'}
        </button>

        <p className="text-xs text-gray-400 text-center">
          Email bude odeslán příjemcům uloženým u tohoto příspěvku.
        </p>
      </section>

    </div>
  );
}
