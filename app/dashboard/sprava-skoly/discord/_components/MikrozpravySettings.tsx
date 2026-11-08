'use client'

// Nastavení mikrozpráv ve správě Discordu (F1-5):
//  1) mapování Discord kanál → výchozí skupina pro /rodicum a /anketa
//  2) „jen mně" — vlastní záznam rodiče zaměstnance pro testovací zprávy

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addChannelGroup, removeChannelGroup, setStaffSelfGuardian } from '@/app/actions/staff-discord'

interface Option { id: string; label: string }

export function ChannelMapping({ mappings, groups }: {
  mappings: { channelId: string; groupId: string; groupName: string }[]
  groups: Option[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [channel, setChannel] = useState('')
  const [group, setGroup] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(null)
    start(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      after?.()
      router.refresh()
    })
  }

  const inputCls = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'

  return (
    <div className="space-y-3">
      {mappings.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-stone-800 dark:border-stone-700">
          {mappings.map(m => (
            <li key={`${m.channelId}-${m.groupId}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span><code className="text-gray-500">#{m.channelId}</code> → <strong>{m.groupName}</strong></span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => removeChannelGroup(m.channelId, m.groupId))}
                className="text-xs text-rose-600 hover:underline disabled:opacity-50"
              >
                Odebrat
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={channel} onChange={e => setChannel(e.target.value)} placeholder="ID kanálu" className={inputCls} />
        <select value={group} onChange={e => setGroup(e.target.value)} className={inputCls}>
          <option value="">— skupina —</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <button
          type="button"
          disabled={pending || !channel || !group}
          onClick={() => run(() => addChannelGroup(channel, group), () => { setChannel(''); setGroup('') })}
          className="rounded-lg bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
        >
          Přidat
        </button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  )
}

export function SelfGuardianRow({ staffId, name, current, guardians }: {
  staffId: string
  name: string
  current: string
  guardians: Option[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [value, setValue] = useState(current)
  const [msg, setMsg] = useState<string | null>(null)

  const save = (v: string) => {
    setValue(v)
    setMsg(null)
    start(async () => {
      const r = await setStaffSelfGuardian(staffId, v)
      setMsg(r.error ?? 'Uloženo')
      if (!r.error) router.refresh()
    })
  }

  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-stone-100">{name}</td>
      <td className="px-4 py-2">
        <select
          value={value}
          disabled={pending}
          onChange={e => save(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900"
        >
          <option value="">— automaticky (stejný účet / e-mail) —</option>
          {guardians.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        {msg && <span className="ml-2 text-xs text-gray-500">{msg}</span>}
      </td>
    </tr>
  )
}
