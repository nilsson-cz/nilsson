'use client';

// app/dashboard/tridni-kniha/[id]/svp/_components/SvpEditForm.tsx
// Client Component — přidávání/odebírání SVP vazeb + AI návrhy (Haiku 4.5)

import { useState, useTransition, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addSvpVazba,
  removeSvpVazba,
  navrhnoutSvpVystupy,
  potvrditSvpNavrh,
  zamitnoutSvpNavrh,
  potvrditVsechnyNavrhy,
} from '@/app/actions/tridni-kniha';

interface Zaznam {
  id: string;
  nazev: string;
  datum: string;
  school_year: string;
}

interface Vystup {
  id: string;
  kod: string;
  rocnik: number;
  predmet: string;
  vystup_text: string;
}

interface Vazba {
  id: string;
  vystup_id: string;
  rocnik: number;
  zdroj: string;
  ai_jistota?: number | null;
  ai_zduvodneni?: string | null;
}

interface Props {
  zaznam: Zaznam;
  existingVazby: Vazba[];
  vystupy: Vystup[];
}

const PREDMETY = [
  'Jazyk a komunikace',
  'Matematika',
  'Orientace ve světě',
  'Pohyb a zdraví',
  'Umění a kultura',
];

function pluralVystupy(n: number): string {
  return n === 1 ? 'výstup' : n < 5 ? 'výstupy' : 'výstupů';
}

export function SvpEditForm({ zaznam, existingVazby, vystupy }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Lokální stav vazeb (optimistic)
  const [vazby, setVazby] = useState<Vazba[]>(existingVazby);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // AI stav
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInfo, setAiInfo] = useState<string | null>(null);

  // Filtry
  const [rocnik, setRocnik] = useState<number | null>(null);
  const [predmet, setPredmet] = useState<string | null>(null);
  const [hledani, setHledani] = useState('');

  const vystupById = useMemo(() => {
    const m = new Map<string, Vystup>();
    for (const v of vystupy) m.set(v.id, v);
    return m;
  }, [vystupy]);

  // Napárované vystup_id → vazba
  const vazbaByVystupId = useMemo(() => {
    const m = new Map<string, Vazba>();
    for (const v of vazby) m.set(v.vystup_id, v);
    return m;
  }, [vazby]);

  // Nepotvrzené AI návrhy
  const navrhy = useMemo(() => vazby.filter((v) => v.zdroj === 'ai_navrh'), [vazby]);
  const pocetPotvrzeno = vazby.length - navrhy.length;

  // Filtrované výstupy
  const filtrovane = useMemo(() => {
    return vystupy.filter((v) => {
      if (rocnik !== null && v.rocnik !== rocnik) return false;
      if (predmet !== null && v.predmet !== predmet) return false;
      if (hledani.trim()) {
        const h = hledani.toLowerCase();
        if (!v.vystup_text.toLowerCase().includes(h) && !v.kod.toLowerCase().includes(h)) return false;
      }
      return true;
    });
  }, [vystupy, rocnik, predmet, hledani]);

  // --- AI akce -------------------------------------------------------------

  async function spustitNavrh() {
    setError(null);
    setAiInfo(null);
    setAiLoading(true);
    const res = await navrhnoutSvpVystupy(zaznam.id);
    setAiLoading(false);

    if (res && 'error' in res && res.error) {
      setError(res.error);
      return;
    }
    const nove = (res as any)?.navrhy as Vazba[] | undefined;
    if (nove?.length) {
      setVazby((prev) => {
        const known = new Set(prev.map((v) => v.vystup_id));
        return [...prev, ...nove.filter((n) => !known.has(n.vystup_id))];
      });
    }
    const count = (res as any)?.count ?? 0;
    setAiInfo(
      count > 0
        ? `AI navrhla ${count} ${pluralVystupy(count)} — zkontrolujte a potvrďte níže.`
        : (res as any)?.info ?? 'AI nenašla žádné nové výstupy k návrhu.',
    );
  }

  async function potvrdit(v: Vazba) {
    setError(null);
    setVazby((prev) => prev.map((x) => (x.id === v.id ? { ...x, zdroj: 'ai_potvrzeno' } : x)));
    const res = await potvrditSvpNavrh(v.id);
    if (res?.error) {
      setError(res.error);
      setVazby((prev) => prev.map((x) => (x.id === v.id ? { ...x, zdroj: 'ai_navrh' } : x)));
    }
  }

  async function zamitnout(v: Vazba) {
    setError(null);
    setVazby((prev) => prev.filter((x) => x.id !== v.id));
    const res = await zamitnoutSvpNavrh(v.id);
    if (res?.error) {
      setError(res.error);
      setVazby((prev) => [...prev, v]);
    }
  }

  async function potvrditVse() {
    setError(null);
    const zasazene = navrhy.map((n) => n.id);
    setVazby((prev) => prev.map((x) => (x.zdroj === 'ai_navrh' ? { ...x, zdroj: 'ai_potvrzeno' } : x)));
    const res = await potvrditVsechnyNavrhy(zaznam.id);
    if (res?.error) {
      setError(res.error);
      setVazby((prev) =>
        prev.map((x) => (zasazene.includes(x.id) ? { ...x, zdroj: 'ai_navrh' } : x)),
      );
    }
  }

  // --- Ruční toggle (jen none ↔ potvrzeno; návrhy se řeší v panelu) ---------

  async function toggleVazba(vystup: Vystup) {
    const existing = vazbaByVystupId.get(vystup.id);
    if (existing && existing.zdroj === 'ai_navrh') return; // návrh se potvrzuje/zamítá výše
    setError(null);

    if (existing) {
      setPendingIds((s) => new Set(s).add(vystup.id));
      setVazby((prev) => prev.filter((v) => v.vystup_id !== vystup.id));
      startTransition(async () => {
        const result = await removeSvpVazba(existing.id);
        if (result?.error) {
          setError(result.error);
          setVazby((prev) => [...prev, existing]); // rollback
        }
        setPendingIds((s) => { const n = new Set(s); n.delete(vystup.id); return n; });
        router.refresh();
      });
    } else {
      setPendingIds((s) => new Set(s).add(vystup.id));
      const optimistic: Vazba = { id: 'pending-' + vystup.id, vystup_id: vystup.id, rocnik: vystup.rocnik, zdroj: 'manual' };
      setVazby((prev) => [...prev, optimistic]);
      startTransition(async () => {
        const result = await addSvpVazba(zaznam.id, vystup.id, vystup.rocnik);
        if (result?.error) {
          setError(result.error);
          setVazby((prev) => prev.filter((v) => v.vystup_id !== vystup.id)); // rollback
        } else if (result?.id) {
          setVazby((prev) => prev.map((v) =>
            v.vystup_id === vystup.id ? { ...v, id: result.id } : v
          ));
        }
        setPendingIds((s) => { const n = new Set(s); n.delete(vystup.id); return n; });
        router.refresh();
      });
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/tridni-kniha" className="hover:text-gray-600">Třídní kniha</Link>
        <span>/</span>
        <Link href={`/dashboard/tridni-kniha/${zaznam.id}`} className="hover:text-gray-600 truncate max-w-xs">
          {zaznam.nazev}
        </Link>
        <span>/</span>
        <span className="text-gray-600">SVP vazby</span>
      </nav>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">SVP vazby</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {pocetPotvrzeno === 0 ? 'Žádné vazby' : `${pocetPotvrzeno} ${pocetPotvrzeno === 1 ? 'vazba' : pocetPotvrzeno < 5 ? 'vazby' : 'vazeb'}`}
            {' · '}
            {zaznam.nazev}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={spustitNavrh}
            disabled={aiLoading}
            className="text-sm font-medium text-white bg-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-wait flex items-center gap-2"
          >
            {aiLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                </svg>
                Navrhuji…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.3 6.2L22 12l-6.7 2.8L13 21l-2.3-6.2L4 12l6.7-2.8L13 3z" />
                </svg>
                Navrhnout výstupy AI
              </>
            )}
          </button>
          <Link
            href={`/dashboard/tridni-kniha/${zaznam.id}`}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Zpět na záznam
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
          </svg>
          {error}
        </div>
      )}

      {aiInfo && !error && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          {aiInfo}
        </div>
      )}

      {/* Panel návrhů AI */}
      {navrhy.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-amber-200">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-amber-900">
                Návrhy AI — {navrhy.length} k potvrzení
              </span>
            </div>
            <button
              onClick={potvrditVse}
              className="text-xs font-medium text-white bg-amber-600 px-2.5 py-1 rounded-md hover:bg-amber-700 transition-colors"
            >
              Potvrdit vše
            </button>
          </div>
          <div className="divide-y divide-amber-100">
            {navrhy.map((v) => {
              const vystup = vystupById.get(v.vystup_id);
              if (!vystup) return null;
              return (
                <div key={v.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-xs font-mono text-amber-700">{vystup.kod}</span>
                      <span className="text-xs text-amber-600">
                        {vystup.predmet} · {vystup.rocnik}. ročník
                      </span>
                      {typeof v.ai_jistota === 'number' && (
                        <span className="text-[11px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          jistota {v.ai_jistota} %
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-snug text-gray-800">{vystup.vystup_text}</p>
                    {v.ai_zduvodneni && (
                      <p className="text-xs text-amber-700/90 mt-1 italic">„{v.ai_zduvodneni}"</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => potvrdit(v)}
                      className="text-xs font-medium text-white bg-gray-900 px-2.5 py-1 rounded-md hover:bg-gray-800 transition-colors"
                    >
                      Potvrdit
                    </button>
                    <button
                      onClick={() => zamitnout(v)}
                      className="text-xs font-medium text-amber-700 border border-amber-300 px-2.5 py-1 rounded-md hover:bg-amber-100 transition-colors"
                    >
                      Zamítnout
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filtry */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">

        {/* Hledání */}
        <input
          type="text"
          placeholder="Hledat výstup…"
          value={hledani}
          onChange={(e) => setHledani(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
        />

        {/* Ročník */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setRocnik(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              rocnik === null ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Všechny ročníky
          </button>
          {[1, 2, 3, 4, 5].map((r) => (
            <button
              key={r}
              onClick={() => setRocnik(rocnik === r ? null : r)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                rocnik === r ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r}. ročník
            </button>
          ))}
        </div>

        {/* Předmět */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setPredmet(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              predmet === null ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Všechny předměty
          </button>
          {PREDMETY.map((p) => (
            <button
              key={p}
              onClick={() => setPredmet(predmet === p ? null : p)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                predmet === p ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Počet výsledků */}
      <p className="text-xs text-gray-400 mb-3 px-1">
        {filtrovane.length} výstupů
        {pocetPotvrzeno > 0 && ` · ${pocetPotvrzeno} označeno`}
        {navrhy.length > 0 && ` · ${navrhy.length} návrh${navrhy.length === 1 ? '' : 'ů'} AI`}
      </p>

      {/* Seznam výstupů */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-50">
        {filtrovane.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-400">
            Žádné výstupy neodpovídají filtru.
          </div>
        ) : (
          filtrovane.map((vystup) => {
            const vazba = vazbaByVystupId.get(vystup.id);
            const stav: 'none' | 'navrh' | 'potvrzeno' =
              !vazba ? 'none' : vazba.zdroj === 'ai_navrh' ? 'navrh' : 'potvrzeno';
            const isPendingItem = pendingIds.has(vystup.id);

            return (
              <button
                key={vystup.id}
                onClick={() => !isPendingItem && stav !== 'navrh' && toggleVazba(vystup)}
                disabled={isPendingItem}
                title={stav === 'navrh' ? 'Návrh AI — potvrďte nebo zamítněte v panelu nahoře' : undefined}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                  stav === 'potvrzeno'
                    ? 'bg-gray-900 hover:bg-gray-800'
                    : stav === 'navrh'
                      ? 'bg-amber-50 cursor-default'
                      : 'hover:bg-gray-50'
                } ${isPendingItem ? 'opacity-50 cursor-wait' : ''}`}
              >
                {/* Checkbox / indikátor */}
                <div className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                  stav === 'potvrzeno'
                    ? 'bg-white border-white'
                    : stav === 'navrh'
                      ? 'border-amber-400 bg-amber-100'
                      : 'border-gray-300 bg-white'
                }`}>
                  {stav === 'potvrzeno' && (
                    <svg className="w-3 h-3 text-gray-900" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  )}
                  {stav === 'navrh' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                </div>

                {/* Obsah */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-xs font-mono ${stav === 'potvrzeno' ? 'text-gray-300' : 'text-gray-400'}`}>
                      {vystup.kod}
                    </span>
                    <span className="text-xs text-gray-400">
                      {vystup.predmet} · {vystup.rocnik}. ročník
                    </span>
                    {stav === 'navrh' && (
                      <span className="text-[11px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                        návrh AI
                      </span>
                    )}
                  </div>
                  <p className={`text-sm leading-snug ${stav === 'potvrzeno' ? 'text-white' : 'text-gray-700'}`}>
                    {vystup.vystup_text}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
