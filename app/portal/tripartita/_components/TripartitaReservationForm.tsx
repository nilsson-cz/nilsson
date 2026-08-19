'use client'

/**
 * app/portal/tripartita/_components/TripartitaReservationForm.tsx
 * Client Component — interaktivní rezervační formulář.
 */

import { useState, useTransition } from 'react'
import { reserveSlot } from '@/app/actions/portal-tripartita'

type Slot = {
  id: string
  label: string
  starts_at: string | null
  ends_at: string | null
  capacity: number
  reserved_count: number
}

type Child = {
  id: string
  first_name: string
  last_name: string
  alreadyReserved: boolean
}

type Event = {
  id: string
  name: string
  description: string | null
  school_year: string
}

type Props = {
  event: Event
  slots: Slot[]
  children: Child[]
}

type ConfirmationData = {
  studentName: string
  slotLabel: string
  eventName: string
}

export default function TripartitaReservationForm({ event, slots, children }: Props) {
  const [isPending, startTransition] = useTransition()

  const [selectedChildId, setSelectedChildId] = useState<string>(
    // Předvyplnit první dítě bez rezervace
    children.find(c => !c.alreadyReserved)?.id ?? children[0]?.id ?? ''
  )
  const [selectedSlotId, setSelectedSlotId] = useState<string>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationData | null>(null)

  const availableSlots = slots.filter(s => s.reserved_count < s.capacity)
  const selectedChild = children.find(c => c.id === selectedChildId)
  const allReserved = children.length > 0 && children.every(c => c.alreadyReserved)

  function handleReserve() {
    if (!selectedChildId) { setError('Vyber dítě.'); return }
    if (!selectedSlotId)  { setError('Vyber termín.'); return }
    if (selectedChild?.alreadyReserved) { setError('Toto dítě již má rezervaci.'); return }
    setError(null)

    startTransition(async () => {
      const result = await reserveSlot(selectedSlotId, selectedChildId, note)
      if (result.success) {
        setConfirmation({
          studentName: result.studentName,
          slotLabel: result.slotLabel,
          eventName: result.eventName,
        })
      } else {
        setError(result.error)
      }
    })
  }

  // ── Potvrzovací obrazovka ─────────────────────────────────────────────────

  if (confirmation) {
    return (
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-1">
          Rezervace potvrzena
        </h2>
        <p className="text-sm text-stone-500 dark:text-stone-400 mb-6">
          Potvrzení jsme vám zaslali e-mailem.
        </p>

        <div className="bg-stone-50 dark:bg-stone-800 rounded-xl p-4 text-left space-y-2 mb-6">
          <div className="flex justify-between gap-3">
            <span className="text-xs text-stone-400 dark:text-stone-500">Událost</span>
            <span className="text-sm font-medium text-stone-800 dark:text-stone-200 text-right">{confirmation.eventName}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-xs text-stone-400 dark:text-stone-500">Termín</span>
            <span className="text-sm font-medium text-stone-800 dark:text-stone-200 text-right">{confirmation.slotLabel}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-xs text-stone-400 dark:text-stone-500">Dítě</span>
            <span className="text-sm font-medium text-stone-800 dark:text-stone-200 text-right">{confirmation.studentName}</span>
          </div>
        </div>

        <p className="text-xs text-stone-400 dark:text-stone-500">
          V případě dotazů nás kontaktujte na{' '}
          <a href="mailto:nilsson@zsvilekula.cz" className="text-orange-500 hover:underline">
            nilsson@zsvilekula.cz
          </a>
        </p>
      </div>
    )
  }

  // ── Prázdný stav — žádné termíny ──────────────────────────────────────────

  if (slots.length === 0) {
    return (
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-8 text-center">
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Zatím nejsou vypsány žádné termíny. Zkuste to prosím později.
        </p>
      </div>
    )
  }

  // ── Všechny děti mají rezervaci ───────────────────────────────────────────

  if (allReserved) {
    return (
      <div className="space-y-4">
        {/* Info o události */}
        <EventInfoCard event={event} />

        <div className="bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-100 dark:border-emerald-900 p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            Všechny vaše děti mají rezervaci.
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">
            Potvrzení bylo zasláno na váš e-mail.
          </p>
        </div>

        {/* Přehled rezervací */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-800">
          {children.map(child => (
            <div key={child.id} className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
                {child.first_name} {child.last_name}
              </span>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                ✓ Rezervováno
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Hlavní formulář ───────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Info o události */}
      <EventInfoCard event={event} />

      {/* Formulář */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-5 space-y-5">

        {/* Výběr dítěte — pouze pokud > 1 */}
        {children.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
              Pro které dítě rezervuješ?
            </label>
            <div className="space-y-2">
              {children.map(child => (
                <button
                  key={child.id}
                  type="button"
                  disabled={child.alreadyReserved}
                  onClick={() => { setSelectedChildId(child.id); setSelectedSlotId(''); setError(null) }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-colors ${
                    child.alreadyReserved
                      ? 'border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 text-stone-400 dark:text-stone-500 cursor-not-allowed'
                      : selectedChildId === child.id
                        ? 'border-orange-400 dark:border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 font-medium'
                        : 'border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:border-stone-300 dark:hover:border-stone-600'
                  }`}
                >
                  <span>{child.first_name} {child.last_name}</span>
                  {child.alreadyReserved && (
                    <span className="text-xs text-emerald-500 dark:text-emerald-400">✓ Rezervováno</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Výběr termínu */}
        <div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
            Vyber termín
          </label>
          {availableSlots.length === 0 ? (
            <p className="text-sm text-stone-400 dark:text-stone-500 py-2">
              Všechny termíny jsou obsazeny.
            </p>
          ) : (
            <div className="space-y-2">
              {slots.map(slot => {
                const isFull = slot.reserved_count >= slot.capacity
                const isSelected = selectedSlotId === slot.id
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={isFull}
                    onClick={() => { setSelectedSlotId(slot.id); setError(null) }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-colors ${
                      isFull
                        ? 'border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 text-stone-400 dark:text-stone-500 cursor-not-allowed'
                        : isSelected
                          ? 'border-orange-400 dark:border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 font-medium'
                          : 'border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:border-stone-300 dark:hover:border-stone-600'
                    }`}
                  >
                    <span>{slot.label}</span>
                    <span className={`text-xs ${
                      isFull
                        ? 'text-stone-400 dark:text-stone-500'
                        : 'text-stone-400 dark:text-stone-500'
                    }`}>
                      {isFull ? 'Obsazeno' : `${slot.capacity - slot.reserved_count} volných`}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Poznámka */}
        <div>
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
            Poznámka <span className="font-normal text-stone-400">(nepovinná)</span>
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Např. témata, která chcete probrat..."
            rows={3}
            className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
          />
        </div>

        {/* Chyba */}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Tlačítko */}
        <button
          onClick={handleReserve}
          disabled={isPending || !selectedSlotId || !selectedChildId || selectedChild?.alreadyReserved}
          className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
        >
          {isPending ? 'Rezervuje se…' : 'Rezervovat termín'}
        </button>
      </div>
    </div>
  )
}

// ── Pomocná komponenta — info o události ──────────────────────────────────────

function EventInfoCard({ event }: { event: Event }) {
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-950 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {event.name}
          </p>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
            {event.school_year}
          </p>
          {event.description && (
            <p className="text-sm text-stone-500 dark:text-stone-400 mt-2">
              {event.description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
