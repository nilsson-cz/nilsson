import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import { getVpCareList, getVpAlertCount } from '@/lib/vp'
import { TYP_PECE_LABEL, VP_STATUS_LABEL } from '@/lib/vp-shared'

export const metadata = { title: 'VP — IS Nilsson' }

export default async function VpPage() {
  const supabase   = await createSupabaseServerClient()
  const careList   = await getVpCareList(CURRENT_SCHOOL_YEAR)
  const alertCount = await getVpAlertCount()

  // Načteme jména žáků — jsou součástí joinu v getVpCareList
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const role = (staffRaw as any)?.role ?? ''
  const canEdit = ['director', 'vp'].includes(role)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Hlavička */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Výchovné poradenství
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Školní rok {CURRENT_SCHOOL_YEAR}
          </p>
        </div>
        {canEdit && (
          <Link
            href="/dashboard/vp/novy"
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
          >
            + Přidat žáka
          </Link>
        )}
      </div>

      {/* Alert banner */}
      {alertCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Pozor:</span> {alertCount} aktivních{' '}
          {alertCount === 1 ? 'alert' : alertCount < 5 ? 'alerty' : 'alertů'} —
          zkontrolujte detail záznamu.
        </div>
      )}

      {/* Prázdný stav */}
      {careList.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Žádné VP záznamy pro {CURRENT_SCHOOL_YEAR}.
          {canEdit && (
            <span>
              {' '}
              <Link href="/dashboard/vp/novy" className="text-orange-500 underline underline-offset-2">
                Přidejte prvního žáka.
              </Link>
            </span>
          )}
        </div>
      )}

      {/* Seznam */}
      {careList.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 text-left">Žák</th>
                <th className="px-4 py-3 text-left">Typ péče</th>
                <th className="px-4 py-3 text-left">Stav</th>
                <th className="px-4 py-3 text-left">ŠPZ platnost</th>
                <th className="px-4 py-3 text-left">IVP</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {careList.map((care: any) => {
                const student = care.students
                const spzExpiring = care.spz_valid_until
                  && new Date(care.spz_valid_until) <= new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
                return (
                  <tr key={care.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {student
                        ? `${student.last_name} ${student.first_name}`
                        : care.student_id}
                      <span className="ml-2 text-xs text-gray-400">
                        {student?.kod_zaka}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        care.typ_pece === 'watch'
                          ? 'bg-gray-100 text-gray-700'
                          : 'bg-orange-100 text-orange-800'
                      }`}>
                        {TYP_PECE_LABEL[care.typ_pece as keyof typeof TYP_PECE_LABEL]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        care.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {VP_STATUS_LABEL[care.status as keyof typeof VP_STATUS_LABEL]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {care.spz_valid_until ? (
                        <span className={spzExpiring ? 'text-red-600 font-medium' : 'text-gray-700'}>
                          {new Date(care.spz_valid_until).toLocaleDateString('cs-CZ')}
                          {spzExpiring && ' ⚠'}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {care.ivp_required ? (
                        <span className="text-gray-700">Ano</span>
                      ) : (
                        <span className="text-gray-400">Ne</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/vp/${care.id}`}
                        className="text-sm text-orange-500 hover:text-orange-700 font-medium"
                      >
                        Detail →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
