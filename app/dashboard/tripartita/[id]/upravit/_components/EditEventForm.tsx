'use client'

/**
 * app/dashboard/tripartita/[id]/upravit/_components/EditEventForm.tsx
 * Client Component — editace události + správa slotů.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateEvent,
  createSlot,
  updateSlot,
  deleteSlot,
} from '@/app/actions/tripartita'

type Slot = {
  id: string
  label: string
  starts_at: string | null
  ends_at: string | null
  capacity: number
  reserved_count: number
}

type Event = {
  id: string
  name: string
  description: string | null
  active: boolean
  school_year: string
}

type Props = {
  event: Event
  slots: Slot[]
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  // Převod ISO → datetime-local formát (YYYY-MM-DDTHH:mm)
  return iso.slice(0, 16)
}

export default function EditEventForm({ event, slots: initialSlots }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // ── Událost ────────────────────────────────────────────────────────────────
  const [name, setName] = useState(event.name)
  const [description, setDescription] = useState(event.description ?? '')
  const [active, setActive] = useState(event.active)
  const [eventError, setEventError] = useState<string | null>(null)
  const [eventSaved, setEventSaved] = useState(false)

  // ── Sloty ──────────────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<Slot[]>(initialSlots)
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({})

  // Nový slot (prázdný formulář dole)
  const [newSlot, setNewSlot] = useState({
    label: '',
    starts_at: '',
    ends_at: '',
    capacity: 1,
  })
  const [newSlotError, setNewSlotError] = useState<string | null>(null)

  // Editovaný slot (inline)
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null)
  const [editingSlotData, setEditingSlotData] = useState<{
    label: string
    starts_at: string
    ends_at: string
    capacity: number
  } | null>(null)

  // ── Handlers — událost ─────────────────────────────────────────────────────

  function handleSaveEvent() {
    if (!name.trim()) {
      setEventError('Název je povinný.')
      return
    }
    setEventError(null)
    setEventSaved(false)
    startTransition(async () => {
      const result = await updateEvent(event.id, { name, description, active })
      if (result.success) {
        setEventSaved(true)
        setTimeout(() => setEventSaved(false), 2000)
      } else {
        setEventError(result.error)
      }
    })
  }

  // ── Handlers — nový slot ───────────────────────────────────────────────────

  function handleAddSlot() {
    if (!newSlot.label.trim()) {
      setNewSlotError('Popisek termínu je povinný.')
      return
    }
    setNewSlotError(null)
    startTransition(async () => {
      const result = await createSlot(event.id, {
        label: newSlot.label,
        starts_at: newSlot.starts_at || undefined,
        ends_at: newSlot.ends_at || undefined,
        capacity: newSlot.capacity,
      })
      if (result.success) {
        setNewSlot({ label: '', starts_at: '', ends_at: '', capacity: 1 })
        // Reload slotů — Server Action provede revalidatePath, ale jsme na klientu
        // → jednodušší je router.refresh() který znovu načte Server Component wrapper
        router.refresh()
      } else {
        setNewSlotError(result.error)
      }
    })
  }

  // ── Handlers — editace slotu ───────────────────────────────────────────────

  function startEditSlot(slot: Slot) {
    setEditingSlotId(slot.id)
    setEditingSlotData({
      label: slot.label,
      starts_at: toDatetimeLocal(slot.starts_at),
      ends_at: toDatetimeLocal(slot.ends_at),
      capacity: slot.capacity,
    })
  }

  function handleSaveSlot(slotId: string) {
    if (!editingSlotData?.label.trim()) {
      setSlotErrors(prev => ({ ...prev, [slotId]: 'Popisek je povinný.' }))
      return
    }
    setSlotErrors(prev => { const n = { ...prev }; delete n[slotId]; return n })
    startTransition(async () => {
      const result = await updateSlot(slotId, event.id, {
        label: editingSlotData!.label,
        starts_at: editingSlotData!.starts_at || undefined,
        ends_at: editingSlotData!.ends_at || undefined,
        capacity: editingSlotData!.capacity,
      })
      if (result.success) {
        setEditingSlotId(null)
        setEditingSlotData(null)
        router.refresh()
      } else {
        setSlotErrors(prev => ({ ...prev, [slotId]: result.error }))
      }
    })
  }

  function handleDeleteSlot(slotId: string, reservedCount: number) {
    if (reservedCount > 0) {
      setSlotErrors(prev => ({ ...prev, [slotId]: 'Nelze smazat termín s rezervací.' }))
      return
    }
    if (!confirm('Smazat tento termín?')) return
    startTransition(async () => {
      const result = await deleteSlot(slotId, event.id)
      if (result.success) {
        setSlots(prev => prev.filter(s => s.id !== slotId))
      } else {
        setSlotErrors(prev => ({ ...prev, [slotId]: result.error }))
      }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push(`/dashboard/tripartita/${event.id}`)}
          className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 flex items-center gap-1 mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Zpět na detail
        </button>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
          Upravit událost
        </h1>
      </div>

      {/* ── Sekce: základní údaje ── */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-6 mb-5">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wide mb-4">
          Základní údaje
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
              Název <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
              Popis <span className="text-stone-400 font-normal">(nepovinný)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActive(!active)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                active ? 'bg-emerald-500' : 'bg-stone-300 dark:bg-stone-600'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                active ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
            <span className="text-sm text-stone-700 dark:text-stone-300">
              {active ? 'Aktivní (rodiče mohou rezervovat)' : 'Archivovaná (rodiče nevidí)'}
            </span>
          </div>

          {eventError && (
            <p className="text-sm text-red-600 dark:text-red-400">{eventError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveEvent}
              disabled={isPending}
              className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {isPending ? 'Ukládá se…' : 'Uložit změny'}
            </button>
            {eventSaved && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400">✓ Uloženo</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Sekce: termíny ── */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 overflow-hidden mb-5">
        <div className="px-6 py-4 border-b border-stone-100 dark:border-stone-800">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wide">
            Termíny ({slots.length})
          </h2>
        </div>

        {slots.length === 0 ? (
          <p className="px-6 py-6 text-sm text-stone-400 dark:text-stone-500">
            Zatím žádné termíny. Přidej první termín níže.
          </p>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {slots.map((slot) => (
              <div key={slot.id} className="px-6 py-4">
                {editingSlotId === slot.id && editingSlotData ? (
                  // ── Inline editační formulář ──
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                          Popisek *
                        </label>
                        <input
                          type="text"
                          value={editingSlotData.label}
                          onChange={e => setEditingSlotData(prev => prev ? { ...prev, label: e.target.value } : prev)}
                          className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                          Začátek
                        </label>
                        <input
                          type="datetime-local"
                          value={editingSlotData.starts_at}
                          onChange={e => setEditingSlotData(prev => prev ? { ...prev, starts_at: e.target.value } : prev)}
                          className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                          Konec
                        </label>
                        <input
                          type="datetime-local"
                          value={editingSlotData.ends_at}
                          onChange={e => setEditingSlotData(prev => prev ? { ...prev, ends_at: e.target.value } : prev)}
                          className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                          Kapacita
                        </label>
                        <input
                          type="number"
                          min={slot.reserved_count}
                          value={editingSlotData.capacity}
                          onChange={e => setEditingSlotData(prev => prev ? { ...prev, capacity: Math.max(slot.reserved_count, parseInt(e.target.value) || 1) } : prev)}
                          className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                        {slot.reserved_count > 0 && (
                          <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
                            Min. {slot.reserved_count} (obsazeno)
                          </p>
                        )}
                      </div>
                    </div>
                    {slotErrors[slot.id] && (
                      <p className="text-xs text-red-600 dark:text-red-400">{slotErrors[slot.id]}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveSlot(slot.id)}
                        disabled={isPending}
                        className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                      >
                        Uložit
                      </button>
                      <button
                        onClick={() => { setEditingSlotId(null); setEditingSlotData(null) }}
                        className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 text-xs font-medium hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
                      >
                        Zrušit
                      </button>
                    </div>
                  </div>
                ) : (
                  // ── Zobrazení slotu ──
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">
                        {slot.label}
                      </p>
                      <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                        Kapacita {slot.capacity} · obsazeno {slot.reserved_count}
                        {slot.starts_at && <> · {new Date(slot.starts_at).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</>}
                      </p>
                      {slotErrors[slot.id] && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{slotErrors[slot.id]}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => startEditSlot(slot)}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                        title="Upravit"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteSlot(slot.id, slot.reserved_count)}
                        disabled={slot.reserved_count > 0}
                        className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={slot.reserved_count > 0 ? 'Nelze smazat — má rezervaci' : 'Smazat'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Přidat nový termín ── */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-700 p-6">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wide mb-4">
          Přidat termín
        </h2>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                Popisek *
              </label>
              <input
                type="text"
                value={newSlot.label}
                onChange={e => setNewSlot(prev => ({ ...prev, label: e.target.value }))}
                placeholder="např. Út 10. 6., 14:00–14:20"
                className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                Začátek <span className="font-normal">(pro ICS)</span>
              </label>
              <input
                type="datetime-local"
                value={newSlot.starts_at}
                onChange={e => setNewSlot(prev => ({ ...prev, starts_at: e.target.value }))}
                className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                Konec <span className="font-normal">(pro ICS)</span>
              </label>
              <input
                type="datetime-local"
                value={newSlot.ends_at}
                onChange={e => setNewSlot(prev => ({ ...prev, ends_at: e.target.value }))}
                className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
                Kapacita
              </label>
              <input
                type="number"
                min={1}
                value={newSlot.capacity}
                onChange={e => setNewSlot(prev => ({ ...prev, capacity: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 px-3 py-2.5 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
          </div>

          {newSlotError && (
            <p className="text-sm text-red-600 dark:text-red-400">{newSlotError}</p>
          )}

          <button
            onClick={handleAddSlot}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 hover:bg-stone-800 dark:hover:bg-stone-200 disabled:opacity-50 text-white dark:text-stone-900 text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {isPending ? 'Přidává se…' : 'Přidat termín'}
          </button>
        </div>
      </div>
    </div>
  )
}
