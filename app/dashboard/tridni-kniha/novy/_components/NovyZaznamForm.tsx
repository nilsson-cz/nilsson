'use client';

// app/dashboard/tridni-kniha/novy/_components/NovyZaznamForm.tsx
// Client Component — formulář nového záznamu třídní knihy s výběrem skupiny

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createZaznam, type CreateZaznamInput, type TypZaznamu } from '@/app/actions/tridni-kniha';
import { computeDenVTydnu } from '@/lib/tridni-kniha-utils';

interface Skupina {
  id: string;
  name: string;
}

interface Props {
  skupiny: Skupina[];
  schoolYear: string;
}

const TYP_OPTIONS: { value: TypZaznamu; label: string; popis: string }[] = [
  { value: 'vyuka', label: 'Výuka', popis: 'Běžný výukový den' },
  { value: 'expedice', label: 'Expedice', popis: 'Terénní program, výlet' },
  { value: 'projekt', label: 'Projekt', popis: 'Projektový den / týden' },
  { value: 'kulturni_akce', label: 'Kulturní akce', popis: 'Divadlo, výstava, koncert' },
  { value: 'sportovni_kurz', label: 'Sportovní kurz', popis: 'Lyžák, plavání, …' },
  { value: 'reditelske_volno', label: 'Ředitelské volno', popis: 'Volno nařízené ředitelem' },
  { value: 'prazdniny', label: 'Prázdniny', popis: 'Státní svátky, školní prázdniny' },
];

const DEN_LABEL: Record<string, string> = {
  po: 'pondělí', út: 'úterý', st: 'středa', čt: 'čtvrtek', pá: 'pátek',
};

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function NovyZaznamForm({ skupiny, schoolYear }: Props) {
  const searchParams = useSearchParams();
  const datumParam = searchParams.get('datum');
  const groupIdParam = searchParams.get('group_id');

  const [datum, setDatum] = useState(datumParam ?? todayISO());
  const [nazev, setNazev] = useState('');
  const [popis, setPopis] = useState('');
  const [typ, setTyp] = useState<TypZaznamu>('vyuka');
  const [casOd, setCasOd] = useState('');
  const [casDo, setCasDo] = useState('');
  // Předvyber: group_id z URL > jediná skupina > prázdné
  const [groupId, setGroupId] = useState<string>(
    groupIdParam ?? (skupiny.length === 1 ? skupiny[0].id : '')
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const den = computeDenVTydnu(datum);
  const isWeekend = den === null;
  const missingGroup = skupiny.length > 1 && !groupId;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nazev.trim()) { setError('Název záznamu je povinný.'); return; }
    if (isWeekend) { setError('Vybrané datum je víkend nebo neplatné. Vyberte pracovní den.'); return; }
    if (missingGroup) { setError('Vyberte třídu.'); return; }

    const input: CreateZaznamInput = {
      datum, nazev,
      popis: popis || undefined,
      typ_zaznamu: typ,
      cas_od: casOd || undefined,
      cas_do: casDo || undefined,
      school_year: schoolYear,
      group_id: groupId || undefined,
    };

    startTransition(async () => {
      const result = await createZaznam(input);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/tridni-kniha" className="hover:text-gray-600">Třídní kniha</Link>
        <span>/</span>
        <span className="text-gray-600">Nový záznam</span>
      </nav>

      <h1 className="text-xl font-semibold text-gray-900 mb-6">Nový záznam</h1>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Třída — zobrazit vždy (i pro jednu skupinu, readonly) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Třída <span className="text-red-500">*</span>
          </label>
          {skupiny.length === 0 ? (
            <p className="text-sm text-red-500">Pro školní rok {schoolYear} nejsou definované žádné třídy.</p>
          ) : skupiny.length === 1 ? (
            <div className="inline-flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
              {skupiny[0].name}
              <span className="text-xs text-gray-400">· {schoolYear}</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {skupiny.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setGroupId(s.id)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                    groupId === s.id
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Datum */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Datum <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="date" value={datum}
              onChange={(e) => setDatum(e.target.value)}
              required
              className="block w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
            {den && <span className="text-sm text-gray-500">{DEN_LABEL[den] ?? den}</span>}
            {isWeekend && datum && (
              <span className="text-sm text-red-500 flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
                Víkend — vyberte pracovní den
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-400">Školní rok: {schoolYear}</p>
        </div>

        {/* Typ záznamu */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Typ záznamu <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {TYP_OPTIONS.map((opt) => (
              <button key={opt.value} type="button" onClick={() => setTyp(opt.value)}
                className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                  typ === opt.value
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}>
                <div className="font-medium">{opt.label}</div>
                <div className={`text-xs mt-0.5 ${typ === opt.value ? 'text-gray-300' : 'text-gray-400'}`}>{opt.popis}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Název */}
        <div>
          <label htmlFor="nazev" className="block text-sm font-medium text-gray-700 mb-1.5">
            Název <span className="text-red-500">*</span>
          </label>
          <input id="nazev" type="text" value={nazev}
            onChange={(e) => setNazev(e.target.value)}
            placeholder={typ === 'vyuka' ? 'např. Matematika, čtení, venkovní program' : 'Stručný název akce'}
            required
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>

        {/* Popis */}
        <div>
          <label htmlFor="popis" className="block text-sm font-medium text-gray-700 mb-1.5">
            Popis <span className="ml-2 text-xs font-normal text-gray-400">volitelné</span>
          </label>
          <textarea id="popis" value={popis} onChange={(e) => setPopis(e.target.value)}
            rows={3} placeholder="Podrobnější popis výukové náplně, průběhu akce, …"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-none"
          />
        </div>

        {/* Čas */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Čas <span className="ml-2 text-xs font-normal text-gray-400">volitelné — u celodenních akcí nevyplňovat</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 w-4">od</span>
              <input type="time" value={casOd} onChange={(e) => setCasOd(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 w-4">do</span>
              <input type="time" value={casDo} onChange={(e) => setCasDo(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent" />
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending || isWeekend || !nazev.trim() || missingGroup || skupiny.length === 0}
            className="inline-flex items-center gap-2 bg-gray-900 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            {isPending ? 'Ukládám…' : 'Uložit záznam'}
          </button>
          <Link href="/dashboard/tridni-kniha" className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2.5">
            Zrušit
          </Link>
        </div>

      </form>

      <div className="mt-8 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-600">
        <strong>Tip:</strong> SVP vazby (propojení dne se ŠVP výstupy) lze přidat po uložení záznamu v jeho detailu.
      </div>
    </div>
  );
}
