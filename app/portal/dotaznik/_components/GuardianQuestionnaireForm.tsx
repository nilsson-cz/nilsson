'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveGuardianQuestionnaire } from '@/app/actions/portal-dotaznik'

type Sibling = { oznaceni: string; rok_narozeni: string; pohlavi: string }

function normalizeSiblings(raw: any): Sibling[] {
  if (!Array.isArray(raw)) return []
  return raw.map((s) => ({
    oznaceni: String(s?.oznaceni ?? ''),
    rok_narozeni: s?.rok_narozeni != null ? String(s.rok_narozeni) : '',
    pohlavi: String(s?.pohlavi ?? ''),
  }))
}

export default function GuardianQuestionnaireForm({ initial }: { initial: any | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [siblings, setSiblings] = useState<Sibling[]>(
    normalizeSiblings(initial?.sourozenci_mimo_skolu)
  )

  function updateSibling(i: number, patch: Partial<Sibling>) {
    setSiblings((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addSibling() {
    setSiblings((prev) => [...prev, { oznaceni: '', rok_narozeni: '', pohlavi: '' }])
  }
  function removeSibling(i: number) {
    setSiblings((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const fd = new FormData(e.currentTarget)
    // Serializace sourozenců (jen neprázdné řádky), rok jako číslo
    const cleaned = siblings
      .filter((s) => s.oznaceni.trim() || s.rok_narozeni.trim() || s.pohlavi)
      .map((s) => ({
        oznaceni: s.oznaceni.trim(),
        rok_narozeni: s.rok_narozeni.trim() ? Number(s.rok_narozeni) : null,
        pohlavi: s.pohlavi || null,
      }))
    fd.set('sourozenci_mimo_skolu_json', JSON.stringify(cleaned))

    startTransition(async () => {
      const res = await saveGuardianQuestionnaire(fd)
      if (res.success) {
        setSaved(true)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="portal-card p-5 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="portal-section-title">O rodině</h2>
        {initial?.updated_at && (
          <span className="text-xs text-(--portal-text-subtle)">
            Naposledy uloženo {new Date(initial.updated_at).toLocaleDateString('cs-CZ')}
          </span>
        )}
      </div>
      <p className="text-xs text-(--portal-text-subtle) -mt-3">
        Vyplňujete jen jednou — platí pro všechny vaše děti u nás ve škole.
      </p>

      <div>
        <label className="block text-sm font-medium text-(--portal-text) mb-1">
          Nějaké závažné sdělení ohledně rodinného zázemí?
        </label>
        <textarea
          name="zavazne_sdeleni"
          rows={3}
          defaultValue={initial?.zavazne_sdeleni ?? ''}
          className="portal-input resize-y"
        />
      </div>

      {/* Sourozenci mimo naši školu */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-(--portal-text)">
          Sourozenci mimo naši školu
        </label>
        <p className="text-xs text-(--portal-text-subtle)">
          Sourozence, kteří chodí k nám, doplňovat nemusíte — načtou se automaticky.
        </p>
        {siblings.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Označení (např. M.)"
              value={s.oznaceni}
              onChange={(e) => updateSibling(i, { oznaceni: e.target.value })}
              className="portal-input flex-1 min-w-[8rem]"
            />
            <input
              type="number"
              placeholder="Rok nar."
              value={s.rok_narozeni}
              onChange={(e) => updateSibling(i, { rok_narozeni: e.target.value })}
              className="portal-input w-24"
            />
            <select
              value={s.pohlavi}
              onChange={(e) => updateSibling(i, { pohlavi: e.target.value })}
              className="portal-input w-28"
            >
              <option value="">Pohlaví</option>
              <option value="z">dívka</option>
              <option value="m">chlapec</option>
            </select>
            <button
              type="button"
              onClick={() => removeSibling(i)}
              className="text-(--portal-text-subtle) hover:text-(--portal-danger) text-sm px-2"
              aria-label="Odebrat sourozence"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addSibling}
          className="text-sm text-(--portal-accent) hover:underline"
        >
          + Přidat sourozence
        </button>
      </div>

      {/* Nabídka spolupráce */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-(--portal-text)">Můžeme nabídnout</legend>
        <label className="flex items-start gap-2 text-sm text-(--portal-text)">
          <input type="checkbox" name="nabidka_exkurze" defaultChecked={!!initial?.nabidka_exkurze} className="mt-0.5" />
          <span>Exkurze na naše pracoviště</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-(--portal-text)">
          <input type="checkbox" name="nabidka_profese" defaultChecked={!!initial?.nabidka_profese} className="mt-0.5" />
          <span>Ukázka naší profese (přijdeme do školy)</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-(--portal-text)">
          <input type="checkbox" name="nabidka_workshop" defaultChecked={!!initial?.nabidka_workshop} className="mt-0.5" />
          <span>Workshop / aktivita pro 5–15 žáků v sebeřízeném bloku</span>
        </label>
        <p className="text-xs text-(--portal-text-subtle) pl-6">
          Workshop trvá 45 minut, probíhá v předem dohodnuté pondělí, středu nebo pátek
          11:30–12:15. Termín i rozsah (5–15 dětí) s vámi včas domluvíme.
        </p>
        <textarea
          name="nabidka_upresneni"
          rows={2}
          placeholder="Upřesnění (obor/téma, počet dětí, kdy se vám hodí…)"
          defaultValue={initial?.nabidka_upresneni ?? ''}
          className="portal-input resize-y mt-1"
        />
      </fieldset>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {saved && !error && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Uloženo.
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-(--portal-accent) text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition"
        >
          {isPending ? 'Ukládám…' : 'Uložit část o rodině'}
        </button>
      </div>
    </form>
  )
}
