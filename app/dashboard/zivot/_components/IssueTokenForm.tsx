'use client'

import { useState, useTransition } from 'react'
import { issueAccessToken } from '@/app/actions/access-tokens'
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config'

export default function IssueTokenForm() {
  const [schoolYear, setSchoolYear] = useState<string>(CURRENT_SCHOOL_YEAR)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleIssue = () => {
    setError(null)
    setIssued(null)
    setCopied(false)

    startTransition(async () => {
      try {
        const result = await issueAccessToken(schoolYear, label || undefined)
        setIssued({ url: result.url })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Vydání selhalo.')
      }
    })
  }

  const handleCopy = async () => {
    if (!issued) return
    await navigator.clipboard.writeText(issued.url)
    setCopied(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="schoolYear">Školní rok</label>
          <select
            id="schoolYear"
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SCHOOL_YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="label">Popisek (volitelné)</label>
          <input
            id="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="např. test"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={handleIssue}
          disabled={isPending}
          className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Vydávám…' : 'Vydat roční odkaz'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {issued && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
          <p className="text-sm font-medium text-amber-800">
            Odkaz se zobrazí jen teď — dál se nikde neukládá.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={issued.url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 border border-amber-300 bg-white rounded-lg px-3 py-2 text-sm font-mono"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 px-3 py-2 bg-white border border-amber-300 text-amber-800 text-sm font-medium rounded-lg hover:bg-amber-100 transition-colors"
            >
              {copied ? '✓ Zkopírováno' : 'Kopírovat'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
