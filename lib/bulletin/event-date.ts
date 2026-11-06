// lib/bulletin/event-date.ts
// Normalizace event_date z formuláře Nástěnky na timestamptz v pražském čase.
//
// Formulář posílá hodnotu z <input type="datetime-local"> ('YYYY-MM-DDTHH:mm',
// bez zóny). Postgres i `new Date()` na serveru (Vercel = UTC) by ji vyložily
// v UTC → akce ve 14:00 by se uložila jako 15:00/16:00 pražského času.

import { pragueLocalToIso } from '@/lib/prague-time'

/**
 * 'YYYY-MM-DDTHH:mm' (Praha) → ISO; samotné datum → půlnoc v Praze;
 * ISO s explicitní zónou projde beze změny; prázdné → null.
 */
export function eventDateToIso(val: string | null | undefined): string | null {
  const v = val?.trim()
  if (!v) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return pragueLocalToIso(`${v}T00:00`)
  const local = pragueLocalToIso(v)
  if (local) return local
  const d = new Date(v)
  return /(Z|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(d.getTime()) ? d.toISOString() : null
}
