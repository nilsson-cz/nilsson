/**
 * app/dashboard/platby/pohledavky/nova/_components/NovaPohledavkaForm.tsx
 *
 * Client Component — formulář pro vytvoření pohledávek.
 * Typ: obědy (měsíční) nebo akce (ad hoc).
 * Každý žák může mít individuální částku.
 * Volitelně odesílá notifikace zákonným zástupcům ihned po insertu.
 */

'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createObligations, type ObligationType } from '@/app/actions/payments'
import type { StudentOption } from '../page'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type StudentRow = {
  studentId: string
  firstName: string
  lastName:  string
  kodZaka:   string
  amount:    string   // string pro input, konvertujeme při submitu
  included:  boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentYearMonth(): { year: number; month: number; label: string } {
  const now = new Date()
  return {
    year:  now.getFullYear(),
    month: now.getMonth() + 1,
    label: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  }
}

function monthOptions(): { value: string; label: string }[] {
  const options = []
  const now = new Date()
  for (let i = -1; i < 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    options.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }),
    })
  }
  return options
}

// ---------------------------------------------------------------------------
// Subkomponenty
// ---------------------------------------------------------------------------

function FormSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wide">
        {title}
      </h2>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-stone-700 mb-1">
      {children}
    </label>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900
        placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400
        focus:border-transparent transition-all ${className}`}
    />
  )
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900
        focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent
        transition-all bg-white"
    >
      {children}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Tabulka žáků s částkami
// ---------------------------------------------------------------------------

function StudentsAmountTable({
  rows,
  onAmountChange,
  onToggle,
  onSetAll,
}: {
  rows: StudentRow[]
  onAmountChange: (studentId: string, amount: string) => void
  onToggle: (studentId: string) => void
  onSetAll: (amount: string) => void
}) {
  const [bulkAmount, setBulkAmount] = useState('')

  const includedCount = rows.filter((r) => r.included).length
  const totalAmount   = rows
    .filter((r) => r.included)
    .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)

  return (
    <div className="space-y-3">
      {/* Hromadné nastavení */}
      <div className="flex items-center gap-2">
        <Input
          value={bulkAmount}
          onChange={setBulkAmount}
          placeholder="Základní cena pro všechny"
          type="number"
          className="flex-1"
        />
        <button
          type="button"
          onClick={() => {
            if (bulkAmount) onSetAll(bulkAmount)
          }}
          className="shrink-0 text-sm font-medium bg-stone-100 hover:bg-stone-200
            text-stone-700 px-3 py-2 rounded-xl transition-colors"
        >
          Nastavit všem
        </button>
      </div>

      {/* Tabulka */}
      <div className="rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              <th className="text-left px-3 py-2.5 text-xs font-medium text-stone-500 w-8">
                <input
                  type="checkbox"
                  checked={rows.every((r) => r.included)}
                  onChange={(e) =>
                    rows.forEach((r) => {
                      if (r.included !== e.target.checked) onToggle(r.studentId)
                    })
                  }
                  className="rounded"
                />
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-stone-500">
                Žák
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-stone-500 w-20">
                Kód
              </th>
              <th className="text-right px-3 py-2.5 text-xs font-medium text-stone-500 w-32">
                Částka (Kč)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((row) => (
              <tr
                key={row.studentId}
                className={`transition-colors ${
                  row.included ? 'bg-white' : 'bg-stone-50 opacity-50'
                }`}
              >
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={row.included}
                    onChange={() => onToggle(row.studentId)}
                    className="rounded"
                  />
                </td>
                <td className="px-3 py-2.5 font-medium text-stone-900">
                  {row.lastName} {row.firstName}
                </td>
                <td className="px-3 py-2.5 text-stone-400 font-mono text-xs">
                  {row.kodZaka}
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="number"
                    value={row.amount}
                    onChange={(e) => onAmountChange(row.studentId, e.target.value)}
                    disabled={!row.included}
                    placeholder="0"
                    className="w-full text-right rounded-lg border border-stone-200 px-2 py-1
                      text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-400
                      disabled:bg-stone-50 disabled:text-stone-400 transition-all"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-stone-50 border-t border-stone-200">
              <td colSpan={3} className="px-3 py-2.5 text-xs text-stone-500">
                {includedCount} žáků zahrnuto
              </td>
              <td className="px-3 py-2.5 text-right text-sm font-semibold text-stone-900">
                {totalAmount.toLocaleString('cs-CZ')} Kč
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hlavní formulář
// ---------------------------------------------------------------------------

export default function NovaPohledavkaForm({
  students,
  schoolYear,
}: {
  students: StudentOption[]
  schoolYear: string
}) {
  const router  = useRouter()
  const [isPending, startTransition] = useTransition()

  // Formulářový stav
  const [type, setType]       = useState<ObligationType>('lunch')
  const [popis, setPopis]     = useState('')
  const [dueDate, setDueDate] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth().label)
  const [notifyGuardians, setNotifyGuardians] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Tabulka žáků
  const [rows, setRows] = useState<StudentRow[]>(() =>
    students
      .slice()
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'cs'))
      .map((s) => ({
        studentId: s.id,
        firstName: s.firstName,
        lastName:  s.lastName,
        kodZaka:   s.kodZaka,
        amount:    '',
        included:  true,
      }))
  )

  const months = useMemo(() => monthOptions(), [])
  const selectedMonthLabel = months.find((m) => m.value === selectedMonth)?.label ?? ''

  function handleTypeChange(newType: ObligationType) {
    setType(newType)
    if (newType === 'lunch' && !popis) {
      setPopis(`Obědy ${selectedMonthLabel}`)
    } else if (newType === 'tuition' && !popis) {
      setPopis(`Školné ${selectedMonthLabel}`)
    }
  }

  function handleMonthChange(value: string) {
    setSelectedMonth(value)
    const label = months.find((m) => m.value === value)?.label ?? ''
    if (type === 'lunch') {
      setPopis(`Obědy ${label}`)
    } else if (type === 'tuition') {
      setPopis(`Školné ${label}`)
    }
  }

  function handleAmountChange(studentId: string, amount: string) {
    setRows((prev) =>
      prev.map((r) => (r.studentId === studentId ? { ...r, amount } : r))
    )
  }

  function handleToggle(studentId: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId ? { ...r, included: !r.included } : r
      )
    )
  }

  function handleSetAll(amount: string) {
    setRows((prev) => prev.map((r) => ({ ...r, amount })))
  }

  function validate(): string | null {
    if (!popis.trim())  return 'Zadejte popis pohledávky'
    if (!dueDate)       return 'Zadejte datum splatnosti'
    const included = rows.filter((r) => r.included)
    if (included.length === 0) return 'Vyberte alespoň jednoho žáka'
    const missingAmount = included.find(
      (r) => r.amount === '' || parseFloat(r.amount) < 0,
    )
    if (missingAmount) {
      return `Chybí nebo neplatná částka pro žáka ${missingAmount.lastName} ${missingAmount.firstName}`
    }
    return null
  }

  function handleSubmit() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSuccessMsg(null)

    const [year, month] = selectedMonth.split('-').map(Number)
    const included = rows.filter((r) => r.included)

    startTransition(async () => {
      const result = await createObligations({
        type,
        popis:           popis.trim(),
        dueDate,
        schoolYear,
        year,
        month,
        students:        included.map((r) => ({
          studentId: r.studentId,
          amount:    parseFloat(r.amount),
        })),
        notifyGuardians,
      })

      if (result.error) {
        setError(result.error)
        return
      }

      // Sestavit zprávu o úspěchu
      const parts = [`Vytvořeno ${result.created} pohledávek.`]
      if (notifyGuardians) {
        parts.push(
          result.notificationsSent
            ? `Odesláno ${result.notificationsSent} e-mailových notifikací.`
            : 'Žádné notifikace nebyly odeslány (žádní zákonní zástupci s e-mailem, nebo všechny částky nulové).',
        )
      }
      setSuccessMsg(parts.join(' '))

      // Krátká prodleva, aby uživatel zprávu zaregistroval, pak přesměrujeme
      setTimeout(() => router.push('/dashboard/platby/pohledavky'), 1800)
    })
  }

  return (
    <div className="space-y-4">
      {/* Základní informace */}
      <FormSection title="Základní informace">
        {/* Typ */}
        <div>
          <Label>Typ pohledávky</Label>
          <div className="flex gap-2">
            {([
              { value: 'lunch',   label: 'Obědy' },
              { value: 'tuition', label: 'Školné' },
              { value: 'event',   label: 'Výjezdní akce' },
            ] as { value: ObligationType; label: string }[]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleTypeChange(opt.value)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
                  type === opt.value
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Měsíc (obědy / školné) */}
        {(type === 'lunch' || type === 'tuition') ? (
          <div>
            <Label>Měsíc</Label>
            <Select value={selectedMonth} onChange={handleMonthChange}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {/* Popis */}
        <div>
          <Label>Popis</Label>
          <Input
            value={popis}
            onChange={setPopis}
            placeholder={
              type === 'lunch' ? 'Obědy leden 2027' : 'Výjezd Krkonoše 2027'
            }
          />
          <p className="mt-1 text-xs text-stone-400">
            Zobrazí se v emailu rodičům a v portálu
          </p>
        </div>

        {/* Datum splatnosti */}
        <div>
          <Label>Datum splatnosti</Label>
          <Input
            type="date"
            value={dueDate}
            onChange={setDueDate}
          />
        </div>
      </FormSection>

      {/* Tabulka žáků */}
      <FormSection title="Žáci a částky">
        <StudentsAmountTable
          rows={rows}
          onAmountChange={handleAmountChange}
          onToggle={handleToggle}
          onSetAll={handleSetAll}
        />
      </FormSection>

      {/* Notifikace */}
      <div className="bg-white rounded-2xl border border-stone-200 px-5 py-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={notifyGuardians}
            onChange={(e) => setNotifyGuardians(e.target.checked)}
            className="mt-0.5 rounded border-stone-300 text-stone-800
              focus:ring-stone-400 focus:ring-offset-0"
          />
          <div>
            <span className="text-sm font-medium text-stone-800">
              Odeslat e-mailové notifikace zákonným zástupcům
            </span>
            <p className="mt-0.5 text-xs text-stone-400">
              Po vytvoření pohledávek se zákonným zástupcům odešle e-mail s výzvou k platbě
              a QR kódem. Notifikace se odešle pouze pro pohledávky s částkou větší než 0 Kč.
            </p>
          </div>
        </label>
      </div>

      {/* Chybová hláška */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Zpráva o úspěchu */}
      {successMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
          <p className="text-sm text-emerald-700">{successMsg}</p>
        </div>
      )}

      {/* Akce */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm font-medium text-stone-500 hover:text-stone-800 transition-colors"
        >
          Zrušit
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="text-sm font-medium bg-stone-800 text-white hover:bg-stone-700
            disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2.5 rounded-xl
            transition-colors"
        >
          {isPending
            ? notifyGuardians ? 'Ukládám a odesílám…' : 'Ukládám…'
            : 'Vytvořit pohledávky'}
        </button>
      </div>
    </div>
  )
}
