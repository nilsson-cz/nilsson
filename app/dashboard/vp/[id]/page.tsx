import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getVpCareById } from '@/lib/vp'
import { TYP_PECE_LABEL, VP_STATUS_LABEL, DOKUMENT_META } from '@/lib/vp-shared'
import { VpEditForm } from './_components/VpEditForm'
import { DokumentyChecklist } from './_components/DokumentyChecklist'
import StudentConsentNotice from '@/app/dashboard/_components/StudentConsentNotice'

export const metadata = { title: 'VP detail — IS Nilsson' }

export default async function VpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const care = await getVpCareById(id)
  if (!care) notFound()

  // Role aktuálního uživatele
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const role    = (staffRaw as any)?.role ?? ''
  const canEdit = ['director', 'vp'].includes(role)

  // Žák
  const { data: student } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka')
    .eq('id', care.student_id)
    .maybeSingle()

  // Aktivní alerty pro tento záznam
  const { data: alerts } = await supabase
    .from('system_alerts')
    .select('id, alert_type, severity, message, created_at')
    .eq('module', 'vp')
    .eq('entity_id', id)
    .is('resolved_at', null)
    .order('severity')

  const studentName = student
    ? `${(student as any).last_name} ${(student as any).first_name}`
    : care.student_id

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* Hlavička */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/dashboard/vp"
            className="text-sm text-gray-400 hover:text-gray-600 mb-1 inline-block"
          >
            ← VP záznamy
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">{studentName}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-500">{(student as any)?.kod_zaka}</span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              care.typ_pece === 'watch'
                ? 'bg-gray-100 text-gray-700'
                : 'bg-orange-100 text-orange-800'
            }`}>
              {TYP_PECE_LABEL[care.typ_pece]}
            </span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              care.status === 'active'
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {VP_STATUS_LABEL[care.status]}
            </span>
            <span className="text-xs text-gray-400">{care.school_year}</span>
          </div>
        </div>
        {/* Odkaz na kartu žáka */}
        <Link
          href={`/dashboard/zaci/${care.student_id}`}
          className="text-sm text-orange-500 hover:text-orange-700"
        >
          Karta žáka →
        </Link>
      </div>

      {/* Alerty */}
      <StudentConsentNotice studentId={care.student_id} onlyCodes={['counseling_special']} />
      {alerts && alerts.length > 0 && (
        <div className="space-y-2">
          {(alerts as any[]).map((alert: any) => (
            <div
              key={alert.id}
              className={`rounded-lg border px-4 py-3 text-sm ${
                alert.severity === 'critical'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <span className="font-medium">
                {alert.severity === 'critical' ? '🔴' : '🟡'}
              </span>{' '}
              {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* Drive složky */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Drive složky
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500 mb-1">Veřejná složka</p>
            {care.drive_url_public ? (
              <a
                href={care.drive_url_public}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-orange-500 underline underline-offset-2 hover:text-orange-700 break-all"
              >
                Otevřít v Drive →
              </a>
            ) : (
              <span className="text-sm text-gray-400">Nevyplněno</span>
            )}
          </div>
          {/* drive_url_private je null pro guide/assistant — filtrováno v lib/vp.ts */}
          {care.drive_url_private !== undefined && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Citlivá složka</p>
              {care.drive_url_private ? (
                <a
                  href={care.drive_url_private}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-orange-500 underline underline-offset-2 hover:text-orange-700 break-all"
                >
                  Otevřít v Drive →
                </a>
              ) : (
                <span className="text-sm text-gray-400">Nevyplněno</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Checklist dokumentů */}
      <DokumentyChecklist
        careId={id}
        dokumenty={care.dokumenty}
        canEdit={canEdit}
      />

      {/* Základní informace + editace */}
      <VpEditForm
        care={care as any}
        canEdit={canEdit}
      />

      {/* Poznámka */}
      {care.poznamka && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Poznámka
          </h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{care.poznamka}</p>
        </div>
      )}

    </div>
  )
}
