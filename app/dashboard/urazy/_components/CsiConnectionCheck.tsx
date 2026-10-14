'use client'

/**
 * CsiConnectionCheck — read-only ověření připojení k ČŠI / InspIS DATA.
 * Nic neodesílá: jen ověří konfiguraci (env), dosažitelnost a přihlášení.
 * Slouží k potvrzení produkční konfigurace po nasazení (sandbox vs ostrá ČŠI).
 */

import { useState, useTransition } from 'react'
import { pingCsi, type CsiPingResult } from '@/app/actions/urazy'

function hostOf(base: string): string {
  try {
    return new URL(base).host
  } catch {
    return base
  }
}

export default function CsiConnectionCheck() {
  const [isPending, startTransition] = useTransition()
  const [res, setRes] = useState<CsiPingResult | null>(null)

  const check = () => {
    setRes(null)
    startTransition(async () => setRes(await pingCsi()))
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <button
        type="button"
        onClick={check}
        disabled={isPending}
        className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Ověřuji…' : 'Ověřit připojení k ČŠI'}
      </button>

      {res?.success && (
        <span className="inline-flex flex-wrap items-center gap-2 text-xs">
          <span className="text-green-600">✓ Připojeno</span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
              res.sandbox ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
            }`}
          >
            {res.sandbox ? 'testovací (sandbox)' : 'ostrá ČŠI'}
          </span>
          <span className="text-gray-500">REDIZO {res.redizo}</span>
          <span className="text-gray-400 font-mono">{hostOf(res.base)}</span>
        </span>
      )}

      {res && !res.success && (
        <span className="inline-flex flex-wrap items-center gap-2 text-xs text-red-600">
          <span>✗ {res.error}</span>
          {res.redizo && <span className="text-gray-400">REDIZO {res.redizo}</span>}
          {res.base && <span className="text-gray-400 font-mono">{hostOf(res.base)}</span>}
        </span>
      )}
    </div>
  )
}
