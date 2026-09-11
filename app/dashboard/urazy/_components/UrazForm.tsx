'use client'

/**
 * UrazForm — sdílený formulář pro NOVÝ i UPRAVOVANÝ záznam o úrazu.
 * Struktura polí kopíruje formulář InspIS DATA 2026 (pole 1–29), rozdělený do
 * čitelných sekcí. Výběr žáka jen PŘEDVYPLNÍ snapshot pole (jméno/příjmení/datum
 * narození) — hodnoty zůstávají editovatelné, protože záznam je fixní k úrazu.
 *
 * Číselníky přicházejí z lib/urazy.ts; ukládá se enum-klíč. Povinnost „záznamu"
 * (je_zaznam) dopočítává server z dnů nepřítomnosti / nároku na náhradu /
 * smrtelnosti — proto je tu ovládáme přímo, ne zvlášť.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CAST_TELA,
  PRICINA,
  DRUH_CINNOSTI,
  MISTO_URAZU,
  PREVENCE,
  ROCNIKY,
  type Ciselnik,
  type UrazZaznam,
} from '@/lib/urazy'
import { createUraz, updateUraz, getUrazPrefill } from '@/app/actions/urazy'

interface Student {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
  birth_date: string | null
}

interface UrazFormProps {
  students: Student[]
  schoolYear: string
  /** Existující záznam → režim úpravy. */
  initial?: UrazZaznam
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function UrazForm({ students, schoolYear, initial }: UrazFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  // Prefill pole (editovatelná i po výběru žáka). Adresa žáka i ZZ se dotahuje
  // z primárního zákonného zástupce (getUrazPrefill) — students adresu nedrží.
  const [prefilling, startPrefill] = useTransition()
  const [studentId, setStudentId] = useState(initial?.student_id ?? '')
  const [jmeno, setJmeno] = useState(initial?.zraneny_jmeno ?? '')
  const [prijmeni, setPrijmeni] = useState(initial?.zraneny_prijmeni ?? '')
  const [datumNarozeni, setDatumNarozeni] = useState(initial?.zraneny_datum_narozeni ?? '')
  const [ulice, setUlice] = useState(initial?.zraneny_ulice ?? '')
  const [psc, setPsc] = useState(initial?.zraneny_psc ?? '')
  const [obec, setObec] = useState(initial?.zraneny_obec ?? '')
  const [zzJmeno, setZzJmeno] = useState(initial?.zz_jmeno ?? '')
  const [zzUlice, setZzUlice] = useState(initial?.zz_ulice ?? '')
  const [zzPsc, setZzPsc] = useState(initial?.zz_psc ?? '')
  const [zzObec, setZzObec] = useState(initial?.zz_obec ?? '')

  const sorted = [...students].sort((a, b) => a.last_name.localeCompare(b.last_name, 'cs'))

  const onPickStudent = (id: string) => {
    setStudentId(id)
    const s = students.find((x) => x.id === id)
    if (s) {
      setJmeno(s.first_name)
      setPrijmeni(s.last_name)
      if (s.birth_date) setDatumNarozeni(s.birth_date)
    }
    if (!id) return
    startPrefill(async () => {
      const p = await getUrazPrefill(id)
      if (!p) return
      setJmeno(p.zraneny.jmeno)
      setPrijmeni(p.zraneny.prijmeni)
      if (p.zraneny.datum_narozeni) setDatumNarozeni(p.zraneny.datum_narozeni)
      setUlice(p.zraneny.ulice ?? '')
      setPsc(p.zraneny.psc ?? '')
      setObec(p.zraneny.obec ?? '')
      setZzJmeno(p.zz.jmeno ?? '')
      setZzUlice(p.zz.ulice ?? '')
      setZzPsc(p.zz.psc ?? '')
      setZzObec(p.zz.obec ?? '')
    })
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setServerError(null)
    const fd = new FormData(e.currentTarget)
    fd.set('school_year', schoolYear)

    startTransition(async () => {
      const result = initial ? await updateUraz(initial.id, fd) : await createUraz(fd)
      if (result.success) {
        router.push(`/dashboard/urazy/${result.id}`)
        router.refresh()
      } else {
        setServerError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Zraněný žák */}
      <Section title="Zraněný">
        <div>
          <Label htmlFor="student_pick">
            Žák (předvyplní jméno, adresu a zákonného zástupce)
            {prefilling && <span className="ml-2 text-xs font-normal text-gray-400">načítám…</span>}
          </Label>
          <select
            id="student_pick"
            value={studentId}
            onChange={(e) => onPickStudent(e.target.value)}
            className={inputCls}
          >
            <option value="">— vybrat žáka —</option>
            {sorted.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name} {s.first_name} · {s.kod_zaka}
              </option>
            ))}
          </select>
          <input type="hidden" name="student_id" value={studentId} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Jméno" required>
            <input name="zraneny_jmeno" required value={jmeno} onChange={(e) => setJmeno(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Příjmení" required>
            <input name="zraneny_prijmeni" required value={prijmeni} onChange={(e) => setPrijmeni(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Datum narození">
            <input type="date" name="zraneny_datum_narozeni" value={datumNarozeni ?? ''} onChange={(e) => setDatumNarozeni(e.target.value)} className={inputCls} />
          </Field>
          <SelectField label="Ročník" name="zraneny_rocnik" ciselnik={ROCNIKY} defaultValue={initial?.zraneny_rocnik != null ? String(initial.zraneny_rocnik) : ''} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Ulice a č.p.">
            <input name="zraneny_ulice" value={ulice} onChange={(e) => setUlice(e.target.value)} className={inputCls} />
          </Field>
          <Field label="PSČ">
            <input name="zraneny_psc" value={psc} onChange={(e) => setPsc(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Obec">
            <input name="zraneny_obec" value={obec} onChange={(e) => setObec(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </Section>

      {/* Zákonný zástupce */}
      <Section title="Zákonný zástupce">
        <Field label="Jméno a příjmení">
          <input name="zz_jmeno" value={zzJmeno} onChange={(e) => setZzJmeno(e.target.value)} className={inputCls} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Ulice a č.p.">
            <input name="zz_ulice" value={zzUlice} onChange={(e) => setZzUlice(e.target.value)} className={inputCls} />
          </Field>
          <Field label="PSČ">
            <input name="zz_psc" value={zzPsc} onChange={(e) => setZzPsc(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Obec">
            <input name="zz_obec" value={zzObec} onChange={(e) => setZzObec(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </Section>

      {/* Úraz a okolnosti */}
      <Section title="Úraz a okolnosti">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Datum a čas úrazu" required>
            <input type="datetime-local" name="datum_cas" required defaultValue={isoToLocalInput(initial?.datum_cas ?? null)} className={inputCls} />
          </Field>
          <AnoNeField label="Zákonný zástupce vyrozuměn" name="zz_vyrozumen" defaultValue={initial?.zz_vyrozumen ?? ''} />
        </div>

        <Field label="Popis události" required>
          <textarea name="popis_udalosti" required rows={4} defaultValue={initial?.popis_udalosti ?? ''} className={`${inputCls} resize-y`} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField label="Zraněná část těla" name="cast_tela" ciselnik={CAST_TELA} defaultValue={initial?.cast_tela ?? ''} />
          <SelectField label="Předpokládaná příčina" name="pricina" ciselnik={PRICINA} defaultValue={initial?.pricina ?? ''} />
          <SelectField label="Druh činnosti" name="druh_cinnosti" ciselnik={DRUH_CINNOSTI} defaultValue={initial?.druh_cinnosti ?? ''} />
          <SelectField label="Místo úrazu" name="misto_urazu" ciselnik={MISTO_URAZU} defaultValue={initial?.misto_urazu ?? ''} />
          <SelectField label="Preventivní opatření školy" name="prevence" ciselnik={PREVENCE} defaultValue={initial?.prevence ?? ''} />
          <AnoNeField label="Zavinění zraněného / jiné osoby" name="zavineni" defaultValue={initial?.zavineni ?? ''} />
        </div>

        <Field label="Zdravotnické zařízení (kde byl ošetřen)">
          <input name="zdravotnicke_zarizeni" defaultValue={initial?.zdravotnicke_zarizeni ?? ''} className={inputCls} />
        </Field>
      </Section>

      {/* Svědci, dohled, sepsání */}
      <Section title="Svědci a dohled">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Svědek úrazu">
            <input name="svedek1" defaultValue={initial?.svedek1 ?? ''} className={inputCls} />
          </Field>
          <Field label="Datum sepsání záznamu">
            <input type="date" name="datum_sepsani" defaultValue={initial?.datum_sepsani ?? ''} className={inputCls} />
          </Field>
          <Field label="Osoba vykonávající dohled — jméno">
            <input name="dohled_jmeno" defaultValue={initial?.dohled_jmeno ?? ''} className={inputCls} />
          </Field>
          <Field label="Osoba vykonávající dohled — funkce">
            <input name="dohled_funkce" defaultValue={initial?.dohled_funkce ?? ''} className={inputCls} />
          </Field>
          <Field label="Přímo nadřízený — jméno">
            <input name="dohled_nadrizeny_jmeno" defaultValue={initial?.dohled_nadrizeny_jmeno ?? ''} className={inputCls} />
          </Field>
          <Field label="Přímo nadřízený — funkce">
            <input name="dohled_nadrizeny_funkce" defaultValue={initial?.dohled_nadrizeny_funkce ?? ''} className={inputCls} />
          </Field>
        </div>
      </Section>

      {/* Povinnost záznamu (naše logika, ne pole ČŠI) */}
      <Section
        title="Povinnost záznamu o úrazu"
        hint="Podle těchto údajů systém určí, zda vzniká záznam o úrazu (formulář), nebo stačí zápis do knihy úrazů."
      >
        <Field label="Předpokládaná nepřítomnost žáka (dny)">
          <input type="number" min={0} name="dny_nepritomnosti" defaultValue={initial?.dny_nepritomnosti ?? ''} className={`${inputCls} sm:w-40`} />
        </Field>
        <div className="space-y-2">
          <Checkbox name="smrtelny" defaultChecked={initial?.smrtelny ?? false} label="Smrtelný úraz" />
          <Checkbox name="narok_nahrada" defaultChecked={initial?.narok_nahrada ?? false} label="Pravděpodobný nárok na náhradu za bolest / ztížení společenského uplatnění" />
          <Checkbox name="na_zadost" defaultChecked={false} label="Záznam vyhotoven na žádost (ZZ / zletilý žák / pojišťovna)" />
        </div>
        <Field label="Interní poznámka">
          <textarea name="poznamka" rows={2} defaultValue={initial?.poznamka ?? ''} className={`${inputCls} resize-y`} />
        </Field>
      </Section>

      {serverError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {serverError}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Ukládám…' : initial ? 'Uložit změny' : 'Vytvořit záznam'}
        </button>
        <a
          href={initial ? `/dashboard/urazy/${initial.id}` : '/dashboard/urazy'}
          className="px-5 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Zrušit
        </a>
      </div>
    </form>
  )
}

// ── Prezentační pomocníci ──────────────────────────────────────────────────

const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h2>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1.5">
      {children}
    </label>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500" aria-hidden> *</span>}
      </span>
      {children}
    </div>
  )
}

function SelectField({
  label,
  name,
  ciselnik,
  defaultValue,
}: {
  label: string
  name: string
  ciselnik: Ciselnik
  defaultValue?: string
}) {
  return (
    <Field label={label}>
      <select name={name} defaultValue={defaultValue ?? ''} className={inputCls}>
        <option value="">—</option>
        {ciselnik.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

function AnoNeField({ label, name, defaultValue }: { label: string; name: string; defaultValue?: string }) {
  return (
    <Field label={label}>
      <select name={name} defaultValue={defaultValue ?? ''} className={inputCls}>
        <option value="">—</option>
        <option value="ano">ano</option>
        <option value="ne">ne</option>
      </select>
    </Field>
  )
}

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultChecked}
        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}
