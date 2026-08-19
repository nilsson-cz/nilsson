import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { removeStudentFromBozp } from '@/app/actions/bozp'
import AddStudentToRecord from '../_components/AddStudentToRecord'

interface PageProps {
  params: Promise<{ id: string }>
}

interface BozpZaznam {
  id: string
  datum: string
  popis: string
  je_hromadne: boolean
  school_year: string
  created_at: string
  created_by: {
    first_name: string
    last_name: string
  } | null
}

interface AttendanceRow {
  student_id: string
  students: {
    id: string
    first_name: string
    last_name: string
    kod_zaka: string
    status: string
  }
}

interface ActiveStudent {
  id: string
  first_name: string
  last_name: string
  kod_zaka: string
}

export default async function BozpDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createServerClient()

  // ZĂˇznam BOZP
  const { data: zaznam, error: zaznamError } = await supabase
    .from('bozp_zaznamy')
    .select(
      `
      id,
      datum,
      popis,
      je_hromadne,
      school_year,
      created_at,
      created_by:staff (first_name, last_name)
    `
    )
    .eq('id', id)
    .single<BozpZaznam>()

  if (zaznamError || !zaznam) {
    notFound()
  }

  // Ĺ˝Ăˇci pĹ™Ă­tomnĂ­ na tomto BOZP zĂˇznamu
  const { data: attendance, error: attError } = await supabase
    .from('bozp_attendance')
    .select(
      `
      student_id,
      students (id, first_name, last_name, kod_zaka, status)
    `
    )
    .eq('bozp_id', id)
    .returns<AttendanceRow[]>()

  // VĹˇichni aktivnĂ­ ĹľĂˇci (pro formulĂˇĹ™ pĹ™idĂˇnĂ­)
  const { data: allActive } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka')
    .eq('status', 'active')
    .returns<ActiveStudent[]>()

  // AktuĂˇlnĂ­ role staff (pro podmĂ­nÄ›nĂ© zobrazenĂ­ tlaÄŤĂ­tka Odebrat)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: currentStaff } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user?.id ?? '')
    .single()
  const canDelete = ['director', 'vp'].includes((currentStaff as any)?.role ?? '')

  const attendanceList = attendance ?? []
  const allActiveList = allActive ?? []

  // Ĺ˝Ăˇci, kteĹ™Ă­ v zĂˇznamu jeĹˇtÄ› nejsou
  const attendedIds = new Set(attendanceList.map((a) => a.student_id))
  const availableToAdd = allActiveList.filter((s) => !attendedIds.has(s.id))

  const datumFormatted = new Date(zaznam.datum).toLocaleDateString('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const createdAtFormatted = new Date(zaznam.created_at).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/bozp" className="hover:text-gray-600 transition-colors">
          BOZP
        </Link>
        <span aria-hidden>â€ş</span>
        <span className="text-gray-700 capitalize">{datumFormatted}</span>
      </nav>

      {/* HlaviÄŤka zĂˇznamu */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{datumFormatted}</h1>
            <span
              className={`mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                zaznam.je_hromadne ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {zaznam.je_hromadne ? 'HromadnĂ© BOZP' : 'IndividuĂˇlnĂ­ BOZP'}
            </span>
          </div>
          <span className="shrink-0 text-sm font-medium text-gray-500">
            {attendanceList.length} ĹľĂˇkĹŻ
          </span>
        </div>

        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-0.5">Popis pouÄŤenĂ­</dt>
            <dd className="text-gray-700">{zaznam.popis}</dd>
          </div>
          <div className="flex gap-6 pt-1">
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-0.5">Ĺ kolnĂ­ rok</dt>
              <dd className="text-gray-700">{zaznam.school_year}</dd>
            </div>
            {zaznam.created_by && (
              <div>
                <dt className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-0.5">Zapsal/a</dt>
                <dd className="text-gray-700">
                  {zaznam.created_by.first_name} {zaznam.created_by.last_name}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-gray-400 text-xs uppercase tracking-wide font-medium mb-0.5">ZapsĂˇno</dt>
              <dd className="text-gray-700">{createdAtFormatted}</dd>
            </div>
          </div>
        </dl>
      </div>

      {/* Ĺ˝Ăˇci proĹˇkolenĂ­ */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          ProĹˇkolenĂ­ ĹľĂˇci
        </h2>

        {attError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Chyba pĹ™i naÄŤĂ­tĂˇnĂ­ dochĂˇzky: {attError.message}
          </div>
        )}

        {attendanceList.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 mb-4">
            {[...attendanceList]
              .sort((a, b) =>
                a.students.last_name.localeCompare(b.students.last_name, 'cs')
              )
              .map((row) => {
                const s = row.students
                return (
                  <div
                    key={row.student_id}
                    className="flex items-center justify-between px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xs" aria-hidden>
                        âś“
                      </span>
                      <span className="text-sm text-gray-900">
                        {s.last_name} {s.first_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gray-400">{s.kod_zaka}</span>
                      {/* Odkaz na detail ĹľĂˇka */}
                      <Link
                        href={`/dashboard/zaci/${s.id}`}
                        className="text-xs text-gray-300 hover:text-gray-500 transition-colors"
                        title="Detail ĹľĂˇka"
                      >
                        â†’
                      </Link>
                      {/* OdebrĂˇnĂ­ â€” pouze director/vp */}
                      {canDelete && (
                        <form
                          action={async () => {
                            'use server'
                            await removeStudentFromBozp(id, row.student_id)
                          }}
                        >
                          <button
                            type="submit"
                            className="text-xs text-red-300 hover:text-red-600 transition-colors px-1"
                            title="Odebrat ĹľĂˇka ze zĂˇznamu"
                          >
                            âś•
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400 mb-4">
            Ĺ˝ĂˇdnĂ­ ĹľĂˇci zatĂ­m v zĂˇznamu nejsou
          </div>
        )}

        {/* PĹ™idat ĹľĂˇka */}
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            PĹ™idat ĹľĂˇka do zĂˇznamu
          </h3>
          <AddStudentToRecord bozpId={id} availableStudents={availableToAdd} />
        </div>
      </section>
    </div>
  )
}



