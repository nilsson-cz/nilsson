import { CURRENT_SCHOOL_YEAR as SCHOOL_YEAR } from '@/lib/config'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import Link from 'next/link'


interface BozpZaznam {
  id: string
  datum: string
  popis: string
  je_hromadne: boolean
  school_year: string
  bozp_attendance: { student_id: string }[]
}

interface StudentBezBozp {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
}

export default async function BozpPage() {
  const supabase = await createServerClient()

  // Záznamy BOZP pro aktuální školní rok — s počtem žáků
  const { data: zaznamy, error: zaznamyError } = await supabase
    .from('bozp_zaznamy')
    .select(
      `
      id,
      datum,
      popis,
      je_hromadne,
      school_year,
      bozp_attendance (student_id)
    `
    )
    .eq('school_year', SCHOOL_YEAR)
    .order('datum', { ascending: false })
    .returns<BozpZaznam[]>()

  // Žáci bez BOZP — přes DB funkci z migrace 015
  const { data: bezBozp, error: bezBozpError } = await supabase
    .rpc('get_students_without_bozp' as any, { p_school_year: SCHOOL_YEAR })
    .returns<StudentBezBozp[]>()

  const zaznamyList = zaznamy ?? []
  const bezBozpList = (bezBozp as any[]) ?? []

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Záhlaví */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">BOZP</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Školní rok {SCHOOL_YEAR} · Bezpečnost a ochrana zdraví při výuce
          </p>
        </div>
        <Link
          href="/dashboard/bozp/novy"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <span aria-hidden>+</span> Nový záznam
        </Link>
      </div>

      {/* Alert: žáci bez BOZP záznamu */}
      {bezBozpError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Chyba při načítání žáků bez BOZP: {bezBozpError.message}
        </div>
      )}

      {bezBozpList.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <span className="text-xl" aria-hidden>
              ⚠️
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-amber-900">
                {bezBozpList.length}{' '}
                {bezBozpList.length === 1 ? 'žák nemá' : 'žáci nemají'} BOZP
                záznam pro {SCHOOL_YEAR}
              </p>
              <ul className="mt-2 space-y-0.5">
                {bezBozpList.map((s) => (
                  <li key={s.id} className="text-sm text-amber-800 flex items-baseline gap-2">
                    <span>
                      {s.last_name} {s.first_name}
                    </span>
                    <span className="text-amber-500 text-xs font-mono">{s.kod_zaka}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-3">
                <Link
                  href="/dashboard/bozp/novy"
                  className="text-sm font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900"
                >
                  Vytvořit hromadné BOZP →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {bezBozpList.length === 0 && !bezBozpError && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-2 text-sm text-green-800">
          <span aria-hidden>✓</span>
          <span>Všichni aktivní žáci mají BOZP záznam pro {SCHOOL_YEAR}.</span>
        </div>
      )}

      {/* Chyba načtení záznamů */}
      {zaznamyError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Chyba při načítání záznamů: {zaznamyError.message}
        </div>
      )}

      {/* Seznam BOZP záznamů */}
      {zaznamyList.length > 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {zaznamyList.map((z) => {
            const pocetZaku = z.bozp_attendance?.length ?? 0
            const datumFormatted = new Date(z.datum).toLocaleDateString('cs-CZ', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })

            return (
              <Link
                key={z.id}
                href={`/dashboard/bozp/${z.id}`}
                className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors group"
              >
                {/* Typ badge */}
                <span
                  className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    z.je_hromadne
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {z.je_hromadne ? 'Hromadné' : 'Individuální'}
                </span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{datumFormatted}</p>
                  <p className="text-sm text-gray-500 truncate">{z.popis}</p>
                </div>

                {/* Počet žáků */}
                <div className="shrink-0 text-right">
                  <span className="text-sm text-gray-500">{pocetZaku} žáků</span>
                  <span className="ml-2 text-gray-300 group-hover:text-gray-400 transition-colors">
                    →
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        !zaznamyError && (
          <div className="rounded-lg border border-dashed border-gray-200 py-16 text-center">
            <p className="text-gray-400 text-sm">Žádné záznamy v {SCHOOL_YEAR}</p>
            <p className="text-gray-300 text-xs mt-1">
              Klikněte na „+ Nový záznam" pro přidání prvního BOZP záznamu
            </p>
          </div>
        )
      )}
    </div>
  )
}

