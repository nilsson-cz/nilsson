/**
 * app/dashboard/_components/StudentConsentNotice.tsx
 * Server Component — zobrazí aktuálně platné NESOUHLASY u žáka.
 *
 * Použití:
 *   FR-X1 (karta žáka, modul Žáci):
 *     <StudentConsentNotice studentId={student.id} />
 *   FR-X2 (VP detail – jen poradenský účel):
 *     <StudentConsentNotice studentId={care.student_id} onlyCodes={['counseling_special']} />
 *
 * Renderuje null, pokud žádný platný nesouhlas (po případném zúžení onlyCodes) není.
 * Data přes get_student_consent_state (RPC povolí personál i zástupce žáka).
 * Gray paleta bez dark: variant — konzistentní s dashboard moduly (VP).
 */

import { getStudentConsentState } from '@/lib/consents'

export default async function StudentConsentNotice({
  studentId,
  onlyCodes,
  title = 'Aktivní nesouhlas se zpracováním',
  className,
}: {
  studentId: string
  onlyCodes?: string[]
  title?: string
  className?: string
}) {
  let denied
  try {
    const rows = await getStudentConsentState(studentId)
    denied = rows.filter((r) => r.state === 'denied')
    if (onlyCodes) denied = denied.filter((r) => onlyCodes.includes(r.code))
  } catch {
    return null
  }

  if (!denied || denied.length === 0) return null

  return (
    <div className={`rounded-lg border border-red-200 bg-red-50 px-4 py-3 ${className ?? ''}`}>
      <p className="text-sm font-medium text-red-800 mb-1.5">{title}</p>
      <ul className="space-y-1">
        {denied.map((r) => (
          <li key={r.code} className="flex items-start gap-2 text-sm text-red-700">
            <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            {r.title}
          </li>
        ))}
      </ul>
    </div>
  )
}
