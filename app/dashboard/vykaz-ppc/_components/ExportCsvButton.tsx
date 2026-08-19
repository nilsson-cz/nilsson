'use client'

/**
 * Stáhne výkaz PPČ jako CSV (oddělovač ';' + BOM → přímé otevření v českém Excelu).
 * Data se generují na klientu z už vykreslených řádků (žádný extra request).
 */
export default function ExportCsvButton({
  filename,
  headers,
  rows,
}: {
  filename: string
  headers: string[]
  rows: (string | number)[][]
}) {
  const download = () => {
    const esc = (v: string | number) => {
      const s = String(v)
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers, ...rows].map((r) => r.map(esc).join(';'))
    const csv = '﻿' + lines.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button type="button" onClick={download}
      className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:border-gray-400 dark:border-stone-700 dark:text-stone-200">
      Export CSV
    </button>
  )
}
