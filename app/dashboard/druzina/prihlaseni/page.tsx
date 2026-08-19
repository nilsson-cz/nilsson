import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import EnrollmentRow from './_components/EnrollmentRow'
import PrihlaskaQueueRow, { type PrihlaskaQueueItem } from './_components/PrihlaskaQueueRow'
import BulkApproveButton from './_components/BulkApproveButton'
import { getActiveSchoolYear } from '@/lib/school-year'

export default async function DruzinaPrivlaseniPage() {
  const supabase = await createSupabaseServerClient()
  const DRUZINA_SCHOOL_YEAR = await getActiveSchoolYear()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .single()
  const staff = staffRaw as any
  if (!staff || staff.role !== 'director') redirect('/dashboard/druzina')

  // Všichni žáci v aktuálním školním roce se třídou
  const { data: membershipsRaw } = await supabase
    .from('group_memberships')
    .select('student_id, groups(id, name), students(id, first_name, last_name, kod_zaka)')
    .eq('school_year', DRUZINA_SCHOOL_YEAR)
  const memberships = (membershipsRaw ?? []) as any[]

  // Všechna přihlášení do družiny pro aktuální školní rok
  const { data: enrollmentsRaw } = await supabase
    .from('druzina_enrollments')
    .select('id, student_id, date_from, date_to, note')
    .eq('school_year', DRUZINA_SCHOOL_YEAR)
    .order('date_from', { ascending: true })
  const enrollments = (enrollmentsRaw ?? []) as any[]

  // Fronta žádostí o přihlášení (self-service portál) čekajících na rozhodnutí
  const { data: prihlaskyRaw } = await supabase
    .from('druzina_prihlasky')
    .select(`
      id, submitted_at, dny_dochazky, odchod_sam, odchod_sam_cas, odchod_doprovod,
      student:student_id ( first_name, last_name, kod_zaka ),
      guardian:guardian_id ( first_name, last_name, phone_primary ),
      druzina_prihlaska_vyzvedavajici ( id )
    `)
    .eq('school_year', DRUZINA_SCHOOL_YEAR)
    .eq('stav', 'odeslana')
    .order('submitted_at', { ascending: true })

  const prihlasky: PrihlaskaQueueItem[] = ((prihlaskyRaw ?? []) as any[]).map((p) => ({
    id:                 p.id,
    submitted_at:       p.submitted_at,
    dny_dochazky:       p.dny_dochazky ?? [],
    odchod_sam:         p.odchod_sam,
    odchod_sam_cas:     p.odchod_sam_cas,
    odchod_doprovod:    p.odchod_doprovod,
    student:            p.student ?? null,
    guardian:           p.guardian ?? null,
    vyzvedavajiciCount: (p.druzina_prihlaska_vyzvedavajici ?? []).length,
  }))

  // Seskupit žáky po třídách
  const byGroup: Record<string, { groupName: string; students: any[] }> = {}
  for (const m of memberships) {
    const gid   = m.groups?.id   ?? 'unknown'
    const gname = m.groups?.name ?? 'Bez třídy'
    if (!byGroup[gid]) byGroup[gid] = { groupName: gname, students: [] }

    const studentEnrollments = enrollments.filter(e => e.student_id === m.students?.id)
    const activeEnrollment   = studentEnrollments.find(e => e.date_to === null) ?? null

    byGroup[gid].students.push({
      ...m.students,
      activeEnrollment,
      enrollmentHistory: studentEnrollments,
    })
  }

  // Seřadit žáky v každé třídě abecedně
  for (const g of Object.values(byGroup)) {
    g.students.sort((a, b) => a.last_name.localeCompare(b.last_name, 'cs'))
  }

  const groups = Object.values(byGroup).sort((a, b) =>
    a.groupName.localeCompare(b.groupName, 'cs')
  )

  const totalEnrolled = enrollments.filter(e => e.date_to === null).length
  const totalStudents = memberships.length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* Hlavička */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-stone-400 mb-1">
            <Link href="/dashboard/druzina" className="hover:text-stone-600 transition-colors">
              Školní družina
            </Link>
            <span>/</span>
            <span className="text-stone-600">Přihlášení</span>
          </div>
          <h1 className="text-xl font-semibold text-stone-900">Přihlášení do družiny</h1>
          <p className="text-sm text-stone-500 mt-0.5">Školní rok {DRUZINA_SCHOOL_YEAR}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-emerald-700">{totalEnrolled}</div>
          <div className="text-xs text-stone-400">přihlášeno z {totalStudents}</div>
        </div>
      </div>

      {/* Fronta žádostí o přihlášení (self-service portál) */}
      <div className="bg-white rounded-xl border border-stone-200">
        <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-700">
            Žádosti čekající na rozhodnutí ({prihlasky.length})
          </h2>
          <BulkApproveButton prihlaskaIds={prihlasky.map((p) => p.id)} />
        </div>
        {prihlasky.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-stone-400">
            Žádné čekající žádosti.
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {prihlasky.map((p) => (
              <PrihlaskaQueueRow key={p.id} item={p} />
            ))}
          </ul>
        )}
      </div>

      {/* Skupiny žáků */}
      {groups.length === 0 && (
        <div className="bg-stone-50 rounded-xl border border-stone-200 px-5 py-8 text-center text-sm text-stone-400">
          Žádní žáci pro školní rok {DRUZINA_SCHOOL_YEAR}.
        </div>
      )}

      {groups.map(group => (
        <div key={group.groupName} className="bg-white rounded-xl border border-stone-200">
          <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-700">{group.groupName}</h2>
            <span className="text-xs text-stone-400">
              {group.students.filter(s => s.activeEnrollment).length} / {group.students.length} přihlášeni
            </span>
          </div>
          <ul className="divide-y divide-stone-100">
            {group.students.map(student => (
              <EnrollmentRow key={student.id} student={student} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

