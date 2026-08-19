// app/dashboard/zivot/galerie/novy/page.tsx
// Nová galerie (koncept). Po uložení redirect na editaci, kde se přidávají
// fotky (Slice C). Slug se odvodí z názvu v server action createGallery.

import Link from 'next/link'
import { createGallery } from '@/app/actions/zivot-galleries'
import { CURRENT_SCHOOL_YEAR, SCHOOL_YEAR_OPTIONS } from '@/lib/config'

export const metadata = { title: 'Nová galerie — Ze života školy' }

export default function NovaGaleriePage() {
  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/zivot/galerie" className="text-sm text-gray-500 hover:text-gray-700">
          ← Zpět na seznam
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900">Nová galerie</h1>

      <form action={createGallery} className="space-y-4">
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
          <label className="text-xs font-medium text-gray-500" htmlFor="description_md">
            Popis galerie (Markdown, volitelné)
          </label>
          <textarea
            id="description_md"
            name="description_md"
            rows={3}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500" htmlFor="event_date">
              Datum akce (volitelné)
            </label>
            <input
              id="event_date"
              name="event_date"
              type="date"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        </div>

        <div className="pt-2">
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Založit galerii
          </button>
        </div>
      </form>
    </div>
  )
}
