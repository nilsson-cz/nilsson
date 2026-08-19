'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setStaffDiscord } from '@/app/actions/staff-discord'

/**
 * Editovatelný řádek: zaměstnanec → Discord ID + přezdívka.
 * Prázdné ID = smazat mapování. Přezdívka je jen popisná (ping jde přes ID).
 */
export default function DiscordIdRow({
  staffId,
  jmeno,
  role,
  neaktivni,
  discordId,
  discordUsername,
}: {
  staffId: string
  jmeno: string
  role: string
  neaktivni: boolean
  discordId: string
  discordUsername: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [id, setId] = useState(discordId)
  const [prezdivka, setPrezdivka] = useState(discordUsername)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = id.trim() !== discordId || prezdivka.trim() !== discordUsername

  const save = () => {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await setStaffDiscord(staffId, id, prezdivka)
      if (res.error) { setError(res.error); return }
      setSaved(true)
      router.refresh()
    })
  }

  const inputCls = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-stone-800/50 transition-colors">
      <td className="px-4 py-2.5 whitespace-nowrap align-top">
        <span className="font-medium text-gray-900 dark:text-stone-100">{jmeno}</span>
        <span className="ml-2 text-xs text-gray-400">{role}</span>
        {neaktivni && <span className="ml-2 text-xs text-amber-600">neaktivní</span>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={id}
            onChange={(e) => { setId(e.target.value); setSaved(false) }}
            placeholder="Discord ID (17–20 číslic)"
            inputMode="numeric"
            className={`w-52 ${inputCls}`}
          />
          <input
            value={prezdivka}
            onChange={(e) => { setPrezdivka(e.target.value); setSaved(false) }}
            placeholder="přezdívka (nepovinné)"
            className={`w-44 ${inputCls}`}
          />
          <button type="button" onClick={save} disabled={pending || !dirty}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
            {pending ? '…' : 'Uložit'}
          </button>
          {saved && !dirty && <span className="text-xs text-emerald-600">✓</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </td>
    </tr>
  )
}
