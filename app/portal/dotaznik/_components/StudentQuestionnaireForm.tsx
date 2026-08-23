'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveStudentQuestionnaire } from '@/app/actions/portal-dotaznik'

type Student = { id: string; first_name: string; last_name: string }
type Sibling = {
  student_id: string
  first_name: string
  last_name: string
  birth_date: string | null
  group_name: string | null
}

function ageFrom(birth: string | null): string {
  if (!birth) return ''
  const b = new Date(birth)
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return `${age} let`
}

// Seed ze Zápisu → návrh do zdr_jine (Zápis má zdravotní info jako jedno pole)
function seedJine(seed: { zdravotni_omezeni: string | null; lekar: string | null } | null): string {
  if (!seed) return ''
  const parts: string[] = []
  if (seed.zdravotni_omezeni) parts.push(seed.zdravotni_omezeni)
  if (seed.lekar) parts.push(`Lékař: ${seed.lekar}`)
  return parts.join('\n')
}

export default function StudentQuestionnaireForm({
  student,
  initial,
  seed,
  siblings,
}: {
  student: Student
  initial: any | null
  seed: { zdravotni_omezeni: string | null; lekar: string | null } | null
  siblings: Sibling[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [lekyOpen, setLekyOpen] = useState<boolean>(!!initial?.leky_podavat_povoleno)

  const seededJine = !initial ? seedJine(seed) : ''

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await saveStudentQuestionnaire(fd)
      if (res.success) {
        setSaved(true)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  const plavecInit =
    initial?.plavec === true ? 'true' : initial?.plavec === false ? 'false' : ''

  return (
    <form onSubmit={handleSubmit} className="portal-card p-5 sm:p-6 space-y-6">
      <input type="hidden" name="student_id" value={student.id} />

      <div className="flex items-center justify-between">
        <h2 className="portal-section-title">
          O dítěti — {student.last_name} {student.first_name}
        </h2>
        {initial?.updated_at && (
          <span className="text-xs text-(--portal-text-subtle)">
            Naposledy uloženo {new Date(initial.updated_at).toLocaleDateString('cs-CZ')}
          </span>
        )}
      </div>

      <Text name="osloveni" label="Oblíbené oslovení dítěte" defaultValue={initial?.osloveni ?? ''} />

      {/* Zdravotní stav */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-(--portal-text)">Zdravotní stav</legend>
        <Area name="zdr_leky" label="Bere léky (jaké)?" defaultValue={initial?.zdr_leky ?? ''} />
        <Area name="zdr_onemocneni_urazy" label="Prodělaná vážná onemocnění a úrazy" defaultValue={initial?.zdr_onemocneni_urazy ?? ''} />
        <Area name="zdr_alergie" label="Alergie" defaultValue={initial?.zdr_alergie ?? ''} />
        <Area name="zdr_pohybova_omezeni" label="Pohybová omezení" defaultValue={initial?.zdr_pohybova_omezeni ?? ''} />
        <Area name="zdr_dietni_omezeni" label="Dietní omezení" defaultValue={initial?.zdr_dietni_omezeni ?? ''} />
        <Area name="zdr_jine" label="Jiné" defaultValue={initial?.zdr_jine ?? seededJine} />
        {seededJine && (
          <p className="text-xs text-(--portal-text-subtle)">
            Předvyplněno z přihlášky — zkontrolujte prosím a případně upřesněte.
          </p>
        )}
      </fieldset>

      {/* Pověření k podávání léků */}
      <fieldset className="space-y-3 rounded-lg border border-(--portal-border) p-4">
        <legend className="px-1 text-sm font-semibold text-(--portal-text)">Podávání léků</legend>
        <label className="flex items-start gap-2 text-sm text-(--portal-text)">
          <input
            type="checkbox"
            name="leky_podavat_povoleno"
            defaultChecked={!!initial?.leky_podavat_povoleno}
            onChange={(e) => setLekyOpen(e.currentTarget.checked)}
            className="mt-0.5"
          />
          <span>Pověřuji školu podáváním léků mému dítěti (dle níže uvedeného dávkování).</span>
        </label>
        {lekyOpen && (
          <div className="space-y-3 pl-6">
            <Area name="leky_davkovani" label="Název léku, dávkování, čas podání" defaultValue={initial?.leky_davkovani ?? ''} />
            <label className="flex items-start gap-2 text-sm text-(--portal-text)">
              <input
                type="checkbox"
                name="leky_potvrzeno_lekarem"
                defaultChecked={!!initial?.leky_potvrzeno_lekarem}
                className="mt-0.5"
              />
              <span>Prohlašuji, že podávání je v souladu s pokyny ošetřujícího lékaře.</span>
            </label>
          </div>
        )}
      </fieldset>

      {/* Plavec */}
      <div>
        <label className="block text-sm font-medium text-(--portal-text) mb-1">Plavec / neplavec</label>
        <select name="plavec" defaultValue={plavecInit} className="portal-input">
          <option value="">— neuvedeno —</option>
          <option value="true">Plavec</option>
          <option value="false">Neplavec</option>
        </select>
      </div>

      <Area name="rodinne_zazemi" label="Rodinné zázemí (s kým dítě žije, pěstounská/střídavá péče…)" defaultValue={initial?.rodinne_zazemi ?? ''} />

      {/* Sourozenci ve škole — jen zobrazení, odvozeno */}
      {siblings.length > 0 && (
        <div className="rounded-lg bg-(--portal-surface-hover) px-4 py-3">
          <p className="text-xs font-medium text-(--portal-text-subtle) mb-1">Sourozenci u nás ve škole</p>
          <ul className="text-sm text-(--portal-text) space-y-0.5">
            {siblings.map((s) => (
              <li key={s.student_id}>
                {s.last_name} {s.first_name}
                {s.group_name ? ` · ${s.group_name}` : ''}
                {s.birth_date ? ` · ${ageFrom(s.birth_date)}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-(--portal-text-subtle) mt-1">
            Načteno automaticky. Sourozence mimo naši školu vyplňte níže v části „O rodině".
          </p>
        </div>
      )}

      <Area name="potreby_navyky" label="Zvláštní potřeby a návyky (denní, noční, pitný, jídelní, záchodový režim aj.)" defaultValue={initial?.potreby_navyky ?? ''} />
      <Area name="obavy" label="Z čeho má strach/obavy? (Co mu na to pomáhá?)" defaultValue={initial?.obavy ?? ''} />
      <Area name="problemy_reseni" label="S čím by mohl nastat problém ve škole či na výjezdu (a jaké řešení doporučujete)?" defaultValue={initial?.problemy_reseni ?? ''} />
      <Area name="vliv_na_chovani" label="Co může (zejména negativně) ovlivňovat chování dítěte?" defaultValue={initial?.vliv_na_chovani ?? ''} />
      <Area name="jine_sdeleni" label="Jiné sdělení pedagogům" defaultValue={initial?.jine_sdeleni ?? ''} />

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
          {isPending ? 'Ukládám…' : 'Uložit část o dítěti'}
        </button>
      </div>
    </form>
  )
}

function Text({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-(--portal-text) mb-1">{label}</label>
      <input type="text" name={name} defaultValue={defaultValue} className="portal-input" />
    </div>
  )
}

function Area({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-(--portal-text) mb-1">{label}</label>
      <textarea name={name} rows={2} defaultValue={defaultValue} className="portal-input resize-y" />
    </div>
  )
}
