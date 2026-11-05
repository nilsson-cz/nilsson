// app/overeni/_components/OvereniShell.tsx
// Rám veřejné ověřovací stránky potvrzení o studiu (bez přihlášení).

import { SKOLA } from '@/lib/enrollment/pdf/layout'

export function OvereniShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <p className="text-sm text-stone-500 dark:text-stone-400">{SKOLA.nazev}</p>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            IČO {SKOLA.ico} · {SKOLA.adresa}
          </p>
          <h1 className="mt-3 text-xl font-semibold text-stone-900 dark:text-stone-100">
            Ověření potvrzení o studiu
          </h1>
        </div>
        {children}
        <p className="text-center text-xs text-stone-400 dark:text-stone-500">
          Nilsson · školní informační systém
        </p>
      </div>
    </div>
  )
}

export function KodForm({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form action="/overeni" method="GET" className="flex gap-2">
      <input
        name="kod"
        defaultValue={defaultValue}
        required
        autoComplete="off"
        placeholder="XXXX-XXXX-XXXX"
        aria-label="Ověřovací kód"
        className="flex-1 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900
          px-3 py-2 text-sm font-mono uppercase tracking-wider text-stone-900 dark:text-stone-100"
      />
      <button
        type="submit"
        className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
      >
        Ověřit
      </button>
    </form>
  )
}
