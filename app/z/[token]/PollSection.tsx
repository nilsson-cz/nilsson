'use client'

// Anketa na stránce /z/{token}: karta za každé dítě (sourozenci), hlas jde měnit
// do uzávěrky, platí poslední (i od druhého rodiče — ukazujeme kdo a kdy).

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Child {
  id: string
  name: string
  optionId: string | null
  votedBy: string | null
  votedAt: string | null
}

export function PollSection({ token, closed, closesText, options, kids, results }: {
  token: string
  closed: boolean
  closesText: string
  options: { id: string; label: string }[]
  kids: Child[]
  results: { label: string; votes: number }[] | null
}) {
  const router = useRouter()
  const [state, setState] = useState(kids)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function vote(childId: string, optionId: string) {
    setBusy(childId)
    setError(null)
    try {
      const res = await fetch(`/api/z/${encodeURIComponent(token)}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: childId, optionId }),
      })
      if (res.ok) {
        const now = new Date().toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour: 'numeric', minute: '2-digit' })
        setState(s => s.map(c => (c.id === childId ? { ...c, optionId, votedBy: 'vy', votedAt: now } : c)))
        router.refresh() // výsledky (pokud je rodiče smí vidět)
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'Hlas se nepodařilo uložit. Zkuste to prosím znovu.')
      }
    } catch {
      setError('Hlas se nepodařilo uložit. Zkontrolujte připojení.')
    } finally {
      setBusy(null)
    }
  }

  const total = results?.reduce((s, r) => s + r.votes, 0) ?? 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-(--portal-text-muted)">
        {closed ? 'Anketa je uzavřená.' : `Hlasujte do ${closesText}. Hlas můžete do té doby změnit.`}
      </p>

      {state.map(child => (
        <div key={child.id} className="rounded-xl border border-(--portal-border) p-3 space-y-2">
          {state.length > 1 && <p className="text-sm font-medium text-(--portal-text)">{child.name}</p>}
          <div className="grid gap-2">
            {options.map(o => {
              const selected = child.optionId === o.id
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={closed || busy === child.id}
                  onClick={() => vote(child.id, o.id)}
                  aria-pressed={selected}
                  className={`w-full rounded-lg px-4 py-3 text-left text-base transition-colors disabled:opacity-60 ${
                    selected
                      ? 'bg-(--portal-accent) font-medium text-white'
                      : 'border border-(--portal-border) text-(--portal-text) hover:border-(--portal-accent)'
                  }`}
                >
                  {selected ? '✓ ' : ''}{o.label}
                </button>
              )
            })}
          </div>
          {child.votedBy && (
            <p className="text-xs text-(--portal-text-subtle)">
              Hlasoval{child.votedBy === 'vy' ? 'i jste' : `/a ${child.votedBy}`} v {child.votedAt}
            </p>
          )}
        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {results && (
        <div className="space-y-1.5 rounded-xl bg-(--portal-bg) p-3">
          <p className="text-xs font-medium text-(--portal-text-muted)">Průběžné výsledky ({total} hlasů)</p>
          {results.map(r => (
            <div key={r.label} className="space-y-0.5">
              <div className="flex justify-between text-sm text-(--portal-text)"><span>{r.label}</span><span>{r.votes}</span></div>
              <div className="h-1.5 rounded bg-(--portal-border)">
                <div className="h-1.5 rounded bg-(--portal-accent)" style={{ width: total ? `${(r.votes / total) * 100}%` : '0%' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
