'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { lockVykazPpc, unlockVykazPpc } from '@/app/actions/vykaz-ppc'

/** Zámek měsíce výkazu PPČ (jen ředitel). Uzamčení = finální výkaz. */
export default function LockButton({ obdobi, locked }: { obdobi: string; locked: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const run = (fn: () => Promise<{ error?: string }>, confirmMsg: string) => {
    if (!window.confirm(confirmMsg)) return
    startTransition(async () => {
      const res = await fn()
      if (res.error) { window.alert(res.error); return }
      router.refresh()
    })
  }

  if (locked) {
    return (
      <button type="button" disabled={pending}
        onClick={() => run(() => unlockVykazPpc(obdobi),
          'Odemknout měsíc? Rozvrh daného měsíce půjde znovu upravovat a výkaz se stane provizorním.')}
        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 hover:border-gray-400 disabled:opacity-50 dark:border-stone-700 dark:text-stone-300">
        {pending ? '…' : 'Odemknout měsíc'}
      </button>
    )
  }

  return (
    <button type="button" disabled={pending}
      onClick={() => run(() => lockVykazPpc(obdobi),
        'Uzamknout měsíc jako finální? Po uzamčení nelze upravovat rozvrh (bloky, obsazení, potvrzení) daného měsíce, dokud jej znovu neodemkneš.')}
      className="px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
      {pending ? '…' : 'Uzamknout měsíc'}
    </button>
  )
}
