'use client'

// Rychlé akce u dokladu: Ignorovat (s důvodem) / Obnovit. Ignorování = ruční přeřazení
// na „Vyloučit z přehledu" (mu_abra_override, vyloucit=true) — doklad se nezapočítá.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteOverride, saveOverride } from '@/app/actions/manazerske-ucetnictvi'

export default function DokladAkce({ flexiId, ignorovanoRucne }: { flexiId: number; ignorovanoRucne: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const ignorovat = () => {
    const duvod = window.prompt('Proč doklad ignorovat? (např. interní přeúčtování, duplicita, osobní výdaj)', 'ignorováno')
    if (duvod === null) return
    start(async () => {
      const res = await saveOverride({ flexiId, cil: 'x', poznamka: duvod.trim() || 'ignorováno' })
      if (res.error) alert(res.error)
      router.refresh()
    })
  }
  const obnovit = () => start(async () => {
    const res = await deleteOverride(flexiId)
    if (res.error) alert(res.error)
    router.refresh()
  })
  return ignorovanoRucne
    ? <button type="button" disabled={pending} onClick={obnovit} className="text-xs text-emerald-700 underline decoration-dotted underline-offset-2 dark:text-emerald-400">{pending ? '…' : 'obnovit'}</button>
    : <button type="button" disabled={pending} onClick={ignorovat} className="text-xs text-gray-600 underline decoration-dotted underline-offset-2 dark:text-stone-300">{pending ? '…' : 'ignorovat'}</button>
}
