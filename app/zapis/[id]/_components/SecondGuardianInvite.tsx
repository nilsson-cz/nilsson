'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { inviteEnrollmentSecondGuardian } from '@/app/actions/enrollment'
import { ZASTUPCE_ROLE_OPTIONS } from '@/lib/enrollment/types'

export interface CoGuardian {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  stav: 'pozvan' | 'zaregistrovan' | 'potvrzeno'
}

const STAV_LABEL: Record<CoGuardian['stav'], string> = {
  pozvan: 'Pozván (čeká na potvrzení)',
  zaregistrovan: 'Zaregistrován',
  potvrzeno: 'Potvrzeno',
}

const STAV_VARIANT: Record<CoGuardian['stav'], string> = {
  pozvan: 'warn',
  zaregistrovan: 'info',
  potvrzeno: 'success',
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function SecondGuardianInvite({
  appId,
  coGuardians,
}: {
  appId: string
  coGuardians: CoGuardian[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [vztah, setVztah] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function odeslat() {
    setError(null); setInfo(null)
    if (!email.trim()) { setError('Zadejte e-mail druhého zástupce.'); return }

    startTransition(async () => {
      const res = await inviteEnrollmentSecondGuardian(appId, {
        email, first_name: firstName, last_name: lastName, pribuzensky_vztah: vztah || undefined,
      })
      if (res.success) {
        setInfo(
          res.data.emailStatus === 'sent'
            ? 'Pozvánka odeslána e-mailem.'
            : 'Zástupce přidán. Pozvánku se ale nepodařilo odeslat e-mailem — zkuste to prosím znovu později.'
        )
        setEmail(''); setFirstName(''); setLastName(''); setVztah(''); setOpen(false)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      {coGuardians.length > 0 && (
        <ul className="space-y-2">
          {coGuardians.map((g) => (
            <li key={g.id} className="flex items-center justify-between rounded-lg border border-(--portal-border) px-4 py-2.5">
              <div className="text-sm">
                <p className="font-medium text-(--portal-text)">
                  {[g.first_name, g.last_name].filter(Boolean).join(' ') || g.email}
                </p>
                <p className="text-xs text-(--portal-text-subtle)">{g.email}</p>
              </div>
              <span className={`portal-pill portal-pill-${STAV_VARIANT[g.stav]}`}>
                {STAV_LABEL[g.stav]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {info && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {info}
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-(--portal-accent) hover:opacity-80"
        >
          + Pozvat dalšího zákonného zástupce
        </button>
      ) : (
        <div className="rounded-lg border border-(--portal-border) p-4 space-y-3">
          <p className="text-sm text-(--portal-text-muted)">
            Druhému zástupci pošleme e-mailem pozvánku k potvrzení žádosti.
            Vy můžete pokračovat bez čekání na jeho potvrzení.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">E-mail <span className="text-red-500">*</span></label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="druhy.rodic@email.cz" className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Jméno</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Příjmení</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Vztah k dítěti</label>
              <select value={vztah} onChange={(e) => setVztah(e.target.value)} className={inputClass}>
                <option value="">— nevybráno —</option>
                {ZASTUPCE_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button type="button" onClick={() => { setOpen(false); setError(null) }} className="text-sm text-(--portal-text-subtle) hover:text-(--portal-text-muted)">
              Zrušit
            </button>
            <button
              type="button" onClick={odeslat} disabled={isPending}
              className="px-4 py-2 rounded-lg bg-(--portal-accent) text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {isPending ? 'Odesílám…' : 'Odeslat pozvánku'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
