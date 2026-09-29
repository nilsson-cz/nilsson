'use client'

// Stažení MŠMT XML přes fetch: při chybě exportu (401/403/422/500 s JSON
// { error }) zobrazí text chyby. Prostý <a download> by chybovou JSON odpověď
// „stáhl" jako xml.json a prohlížeč by hlásil nedostupný web.

import { useState } from 'react'

export function StahnoutXml({ href, filename }: { href: string; filename: string }) {
  const [stav, setStav] = useState<'idle' | 'loading'>('idle')
  const [chyba, setChyba] = useState<string | null>(null)

  async function stahnout() {
    setStav('loading')
    setChyba(null)
    try {
      const res = await fetch(href)
      if (!res.ok) {
        let text = `Export selhal (HTTP ${res.status}).`
        try {
          const body = await res.json()
          if (body?.error) text = String(body.error)
        } catch {}
        setChyba(text)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setChyba(e instanceof Error ? e.message : 'Stažení se nezdařilo.')
    } finally {
      setStav('idle')
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={stahnout}
        disabled={stav === 'loading'}
        className="px-4 py-1.5 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
      >
        {stav === 'loading' ? 'Generuji…' : 'Stáhnout'}
      </button>
      {chyba && <p className="max-w-xs text-right text-xs text-red-600">{chyba}</p>}
    </div>
  )
}
