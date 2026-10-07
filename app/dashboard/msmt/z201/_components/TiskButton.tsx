'use client'

export default function TiskButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 print:hidden"
    >
      Tisk / PDF
    </button>
  )
}
