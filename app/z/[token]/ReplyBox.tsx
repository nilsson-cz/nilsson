'use client'

// „Napsat škole" na stránce mikrozprávy (PRD D11). Odpověď uvidí tým v Nilssonu;
// do Discordu jde jen upozornění. Není to chat — učitel se ozve telefonem / další zprávou.

import { useState } from 'react'

export function ReplyBox({ token, phone }: { token: string; phone: string | null }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/z/${encodeURIComponent(token)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      if (res.ok) { setDone(true); setText('') }
      else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error ?? 'Odpověď se nepodařilo odeslat.')
      }
    } catch {
      setError('Odpověď se nepodařilo odeslat. Zkontrolujte připojení.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="text-sm text-(--portal-text-muted)">
        ✓ Odpověď jsme předali týmu školy.{' '}
        <button type="button" onClick={() => setDone(false)} className="underline">Napsat další</button>
      </p>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-(--portal-accent) underline">
        ✉️ Napsat škole
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="Např. Pro Elišku dnes přijde dědeček."
        className="w-full rounded-lg border border-(--portal-border) bg-transparent px-3 py-2 text-sm text-(--portal-text)"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          className="rounded-lg bg-(--portal-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Odeslat
        </button>
        <span className="text-xs text-(--portal-text-subtle)">
          Uvidí ji tým školy.{phone ? ` Když spěchá, volejte ${phone}.` : ''}
        </span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
