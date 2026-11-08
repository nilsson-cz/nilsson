'use client'

import { useState } from 'react'

export function AckButton({ token, initiallyAcked, prominent }: {
  token: string
  initiallyAcked: boolean
  prominent: boolean
}) {
  const [acked, setAcked] = useState(initiallyAcked)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ack() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/z/${encodeURIComponent(token)}/ack`, { method: 'POST' })
      if (res.ok) setAcked(true)
      else {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'Nepodařilo se uložit. Zkuste to prosím znovu.')
      }
    } catch {
      setError('Nepodařilo se uložit. Zkontrolujte připojení.')
    } finally {
      setBusy(false)
    }
  }

  if (acked) {
    return <p className="rounded-lg bg-(--portal-accent-subtle) px-4 py-3 text-sm font-medium text-(--portal-accent)">👍 Potvrzeno, díky!</p>
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={ack}
        disabled={busy}
        className={prominent
          ? 'w-full rounded-lg bg-(--portal-accent) px-4 py-3 text-base font-medium text-white disabled:opacity-60'
          : 'rounded-lg border border-(--portal-border) px-4 py-2 text-sm text-(--portal-text-muted) disabled:opacity-60'}
      >
        👍 Beru na vědomí
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
