'use client'

import { useState, useTransition } from 'react'
import { updateLunchSettings, sendTestSms, testSmsAuth } from '@/app/actions/lunch-admin'

// Ředitelský formulář nastavení denní SMS jídelně + test odeslání.

type Settings = {
  report_phone: string | null
  sms_enabled: boolean
  send_hour: number
}

export default function LunchSettingsForm({ settings }: { settings: Settings }) {
  const [phone, setPhone] = useState(settings.report_phone ?? '')
  const [enabled, setEnabled] = useState(settings.sms_enabled)
  const [hour, setHour] = useState(settings.send_hour)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()

  const [testPhone, setTestPhone] = useState('')
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testPending, startTest] = useTransition()

  const [authMsg, setAuthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [authPending, startAuth] = useTransition()

  function save() {
    setSaveMsg(null)
    startSave(async () => {
      const res = await updateLunchSettings({ report_phone: phone, sms_enabled: enabled, send_hour: hour })
      if (res.ok) setSaveMsg({ ok: true, text: 'Uloženo.' })
      else setSaveMsg({ ok: false, text: res.error ?? 'Nezdařilo se.' })
    })
  }

  function test() {
    setTestMsg(null)
    startTest(async () => {
      const res = await sendTestSms(testPhone)
      if (res.ok) setTestMsg({ ok: true, text: res.detail ?? 'Odesláno.' })
      else setTestMsg({ ok: false, text: res.error ?? 'Nezdařilo se.' })
    })
  }

  function checkAuth() {
    setAuthMsg(null)
    startAuth(async () => {
      const res = await testSmsAuth()
      if (res.ok) setAuthMsg({ ok: true, text: res.detail ?? 'Přihlášení OK.' })
      else setAuthMsg({ ok: false, text: res.error ?? 'Nezdařilo se.' })
    })
  }

  const inputCls =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100'

  return (
    <div className="space-y-6">
      {/* Nastavení */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4 dark:border-stone-700 dark:bg-stone-900">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-stone-300 mb-1">
            Telefon jídelny (příjemce SMS)
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+420 777 123 456"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-gray-400">Na toto číslo chodí ráno SMS s počtem obědů na daný den.</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-gray-700 dark:text-stone-300">Odesílat denní SMS</span>
            <p className="text-xs text-gray-400">Vypnutím se ranní report pozastaví (objednávky běží dál).</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-orange-500' : 'bg-gray-300 dark:bg-stone-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-stone-300 mb-1">
            Hodina odeslání (Europe/Prague)
          </label>
          <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={`${inputCls} max-w-[120px]`}>
            {Array.from({ length: 24 }).map((_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">SMS odejde v/po této hodině; cron míří na 06:00 s ohledem na letní/zimní čas.</p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={save}
            disabled={savePending}
            className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
          >
            {savePending ? 'Ukládám…' : 'Uložit nastavení'}
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{saveMsg.text}</span>
          )}
        </div>
      </div>

      {/* Test */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3 dark:border-stone-700 dark:bg-stone-900">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Testovací SMS</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Ověří bránu naostro (odešle se reálná SMS na kredit školy). Nechte prázdné pro odeslání na číslo jídelny,
            nebo zadejte vlastní číslo (např. své) pro test bez obtěžování jídelny.
          </p>
        </div>

        {/* Diagnostika: ověří jen přihlášení, neodešle SMS a nestojí kredit */}
        <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-gray-100 dark:border-stone-800">
          <button
            type="button"
            onClick={checkAuth}
            disabled={authPending}
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            {authPending ? 'Ověřuji…' : 'Ověřit přihlášení (bez SMS)'}
          </button>
          {authMsg && (
            <span className={`text-sm ${authMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{authMsg.text}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="(prázdné = číslo jídelny)"
            className={`${inputCls} max-w-[220px]`}
          />
          <button
            type="button"
            onClick={test}
            disabled={testPending}
            className="px-4 py-2 border border-orange-300 text-orange-700 text-sm font-medium rounded-lg hover:bg-orange-50 disabled:opacity-50 transition-colors dark:border-orange-900 dark:text-orange-300 dark:hover:bg-orange-950/40"
          >
            {testPending ? 'Odesílám…' : 'Poslat test'}
          </button>
          {testMsg && (
            <span className={`text-sm ${testMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{testMsg.text}</span>
          )}
        </div>
      </div>
    </div>
  )
}
