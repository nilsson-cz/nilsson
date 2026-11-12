// Filtr období: předvolby + „Volitelné období" (selecty měsíc/rok, fungují v každém prohlížeči).
// Server Component; `extra` = další parametry stránky (filtry), které se při změně období zachovají.

import Link from 'next/link'
import { muPresets } from '@/lib/manazerske-ucetnictvi/report'
import CustomRange from './CustomRange'

export default function RangeFilter({ path, od, doP, max, extra = '' }: { path: string; od: string; doP: string; max: string; extra?: string }) {
  const presets = muPresets()
  const aktivniPreset = presets.some((p) => p.od === od && p.do === doP)
  const sufix = extra ? `&${extra}` : ''
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((p) => {
          const active = p.od === od && p.do === doP
          return (
            <Link key={p.label} href={`${path}?od=${p.od}&do=${p.do}${sufix}`}
              className={`rounded-full border px-2.5 py-1 text-xs ${active
                ? 'border-gray-900 bg-gray-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'}`}>
              {p.label}
            </Link>
          )
        })}
        <CustomRange key={`${od}|${doP}`} path={path} od={od} doP={doP} max={max} extra={extra} otevreno={!aktivniPreset} />
      </div>
      <p className="text-xs text-gray-500 dark:text-stone-400">
        Zobrazeno období: <span className="font-medium text-gray-700 dark:text-stone-300">{od}</span> – <span className="font-medium text-gray-700 dark:text-stone-300">{doP}</span>
      </p>
    </div>
  )
}
