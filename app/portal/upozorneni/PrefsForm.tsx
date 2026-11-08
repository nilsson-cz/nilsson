'use client'

import { useState, useTransition } from 'react'
import { saveNotificationPrefs, type ChannelMode } from '@/app/actions/portal-upozorneni'

const MODES: { value: ChannelMode; label: string; desc: string }[] = [
  { value: 'auto', label: 'Automaticky (doporučeno)', desc: 'Do telefonu, když máte zapnutá upozornění; jinak e-mailem.' },
  { value: 'push_email', label: 'Telefon i e-mail', desc: 'Každá zpráva přijde do telefonu a zároveň e-mailem.' },
  { value: 'email_only', label: 'Jen e-mail', desc: 'Do telefonu nic, všechno e-mailem.' },
]

export function PrefsForm({ initialMode, initialMute }: { initialMode: ChannelMode; initialMute: boolean }) {
  const [mode, setMode] = useState<ChannelMode>(initialMode)
  const [mute, setMute] = useState(initialMute)
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  const dirty = mode !== initialMode || mute !== initialMute

  function save() {
    setMsg(null)
    startTransition(async () => {
      const r = await saveNotificationPrefs(mode, mute)
      setMsg(r.error ?? 'Uloženo.')
    })
  }

  return (
    <section className="portal-card space-y-4 px-4 py-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-(--portal-text)">Jak vám zprávy posílat</legend>
        {MODES.map(o => (
          <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-(--portal-border) px-3 py-2">
            <input
              type="radio"
              name="mode"
              value={o.value}
              checked={mode === o.value}
              onChange={() => setMode(o.value)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm text-(--portal-text)">{o.label}</span>
              <span className="block text-xs text-(--portal-text-muted)">{o.desc}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={mute} onChange={e => setMute(e.target.checked)} className="mt-1" />
        <span>
          <span className="block text-sm text-(--portal-text)">Ztlumit běžné zprávy</span>
          <span className="block text-xs text-(--portal-text-muted)">
            Do telefonu přijdou jen ⚡ naléhavé. Ostatní uvidíte ve Zprávách
            {mode === 'auto' ? '' : ' a v e-mailu'}.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-lg bg-(--portal-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Uložit
        </button>
        {msg && <span className="text-sm text-(--portal-text-muted)">{msg}</span>}
      </div>
    </section>
  )
}
