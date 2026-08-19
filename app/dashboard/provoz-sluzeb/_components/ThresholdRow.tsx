'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setUsageThreshold } from '@/app/actions/usage-monitor'

/**
 * Editovatelný řádek konfigurace prahu jedné metriky.
 * Ruční limit se uplatní tam, kde ho API nevrací (Supabase i GitHub — enhanced
 * billing už included_minutes nehlásí). Poměry přijímají procenta (80) i zlomek (0.8).
 */
export default function ThresholdRow({
  service,
  metric,
  label,
  unit,
  serviceLabel,
  manualLimit,
  warnRatio,
  critRatio,
  enabled,
  apiProvidesLimit,
}: {
  service: string
  metric: string
  label: string
  unit: string | null
  serviceLabel: string
  manualLimit: number | null
  warnRatio: number
  critRatio: number
  enabled: boolean
  apiProvidesLimit: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [limit, setLimit] = useState(manualLimit === null ? '' : String(manualLimit))
  const [warn, setWarn] = useState(String(Math.round(warnRatio * 100)))
  const [crit, setCrit] = useState(String(Math.round(critRatio * 100)))
  const [on, setOn] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = () => {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await setUsageThreshold({
        service, metric,
        manualLimit: limit,
        warnRatio: warn,
        critRatio: crit,
        enabled: on,
      })
      if (res.error) { setError(res.error); return }
      setSaved(true)
      router.refresh()
    })
  }

  const inputCls = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-stone-800/50 transition-colors align-top">
      <td className="px-4 py-2.5 whitespace-nowrap">
        <span className="font-medium text-gray-900 dark:text-stone-100">{label}</span>
        <span className="ml-2 text-xs text-gray-400">{serviceLabel}</span>
      </td>
      <td className="px-3 py-2.5">
        {apiProvidesLimit ? (
          <span className="text-xs text-gray-400" title="Limit hlásí přímo API služby">z API</span>
        ) : (
          <div className="flex items-center gap-1">
            <input
              value={limit}
              onChange={(e) => { setLimit(e.target.value); setSaved(false) }}
              placeholder="neomezeno"
              inputMode="decimal"
              className={`w-24 ${inputCls}`}
            />
            {unit && <span className="text-xs text-gray-400">{unit}</span>}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <input value={warn} onChange={(e) => { setWarn(e.target.value); setSaved(false) }}
            inputMode="numeric" className={`w-14 ${inputCls}`} />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <input value={crit} onChange={(e) => { setCrit(e.target.value); setSaved(false) }}
            inputMode="numeric" className={`w-14 ${inputCls}`} />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-stone-300">
          <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setSaved(false) }} />
          alert
        </label>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button type="button" onClick={save} disabled={pending}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
            {pending ? '…' : 'Uložit'}
          </button>
          {saved && <span className="text-xs text-emerald-600">✓</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </td>
    </tr>
  )
}
