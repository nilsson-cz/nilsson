'use client'

// components/dashboard/StudentSearchWidget.tsx
// Rychlé hledání žáka — client-side, debounced
// Hledá v: first_name, last_name, kod_zaka
// Po výběru: naviguje na /dashboard/zaci/{id}

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

type StudentResult = {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string | null
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export default function StudentSearchWidget() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StudentResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const debouncedQuery = useDebounce(query, 250)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    if (debouncedQuery.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }

    let cancelled = false

    async function search() {
      setLoading(true)
      const q = debouncedQuery.trim()

      const { data, error } = await supabase
        .from('students')
        .select('id, first_name, last_name, kod_zaka')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,kod_zaka.ilike.%${q}%`)
        .order('last_name')
        .limit(8)

      if (!cancelled) {
        setResults(error ? [] : (data as any[]) ?? [])
        setOpen(true)
        setLoading(false)
      }
    }

    search()
    return () => { cancelled = true }
  }, [debouncedQuery])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSelect(student: StudentResult) {
    setOpen(false)
    setQuery('')
    router.push(`/dashboard/zaci/${student.id}`)
  }

  return (
    <div ref={containerRef} className="relative bg-white rounded-2xl border border-stone-200 p-4">
      <div className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Hledat žáka — jméno nebo kód…"
          className="
            w-full pl-10 pr-10 py-2.5 rounded-xl bg-stone-50 border border-stone-200
            text-sm text-stone-900 placeholder:text-stone-400
            focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600
            transition
          "
        />

        {loading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <svg className="animate-spin w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>

      {/* Výsledky */}
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-stone-200 rounded-2xl shadow-lg overflow-hidden">
          {results.map((student) => (
            <li key={student.id}>
              <button
                onClick={() => handleSelect(student)}
                className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-stone-50 transition-colors"
              >
                <span className="text-sm font-medium text-stone-900">
                  {student.last_name} {student.first_name}
                </span>
                {student.kod_zaka && (
                  <span className="text-xs text-stone-400 font-mono ml-3">
                    {student.kod_zaka}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Žádné výsledky */}
      {open && !loading && results.length === 0 && debouncedQuery.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-stone-200 rounded-2xl shadow-lg px-4 py-3">
          <p className="text-sm text-stone-400">Žádný žák nenalezen</p>
        </div>
      )}
    </div>
  )
}
