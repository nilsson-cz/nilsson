// lib/prague-time.ts
// Převod mezi <input type="datetime-local"> a timestamptz v pražském čase.
//
// Proč: hodnota datetime-local ('YYYY-MM-DDTHH:mm') nemá časovou zónu.
// `new Date(val)` ji vyloží v zóně procesu — na Vercelu UTC — takže „14:00"
// se uložilo jako 14:00 UTC = 15:00 SEČ / 16:00 SELČ. Tady ji vždy čteme
// a píšeme jako Europe/Prague, nezávisle na zóně serveru i prohlížeče.

const TZ = 'Europe/Prague'

/** Posun Europe/Prague vůči UTC v milisekundách v daném okamžiku. */
function pragueOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** 'YYYY-MM-DDTHH:mm' v pražském čase → ISO (UTC), nebo null. */
export function pragueLocalToIso(val?: string | null): string | null {
  const m = val?.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const wallAsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  // Dva kroky kvůli přechodu SEČ/SELČ: posun se počítá v cílovém okamžiku.
  let utc = wallAsUtc - pragueOffsetMs(wallAsUtc)
  utc = wallAsUtc - pragueOffsetMs(utc)
  return new Date(utc).toISOString()
}

/** ISO (timestamptz) → 'YYYY-MM-DDTHH:mm' v pražském čase pro datetime-local. */
export function isoToPragueLocal(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // sv-SE dává 'YYYY-MM-DD HH:mm'
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(' ', 'T')
}
