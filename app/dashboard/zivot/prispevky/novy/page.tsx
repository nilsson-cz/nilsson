// app/dashboard/zivot/prispevky/novy/page.tsx
// Nový příspěvek (koncept). Po uložení redirect na editaci. Slug se odvodí
// z názvu v server action createPost; RLS staff_manage_posts jistí zápis.

import Link from 'next/link'
import { createPost } from '@/app/actions/zivot-posts'
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config'

export const metadata = { title: 'Nový příspěvek — Ze života školy' }

export default function NovyPrispevekPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/zivot/prispevky" className="text-sm text-gray-500 hover:text-gray-700">
          ← Zpět na seznam
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900">Nový příspěvek</h1>

      <form action={createPost} className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="title">Název</label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={200}
            placeholder="např. Podzimní expedice do lesa"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="body_md">
            Text příspěvku (Markdown)
          </label>
          <textarea
            id="body_md"
            name="body_md"
            rows={8}
            placeholder="## Nadpis&#10;&#10;Text v **markdownu**, odrážky, odkazy…"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500" htmlFor="school_year">Školní rok</label>
          <select
            id="school_year"
            name="school_year"
            defaultValue={CURRENT_SCHOOL_YEAR}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SCHOOL_YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Založit příspěvek
          </button>
        </div>
      </form>
    </div>
  )
}
