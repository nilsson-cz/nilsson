// lib/push/pilot.ts
// Pilot web push (Mikrozprávy F1-0): PUSH_PILOT_GUARDIAN_IDS = čárkami oddělená
// guardian UUID, nebo 'all' pro všechny. Nenastaveno = karta zapnutí se nezobrazí.

export function pushPilotEnabled(guardianId: string | null): boolean {
  const raw = (process.env.PUSH_PILOT_GUARDIAN_IDS ?? '').trim()
  if (!raw || !guardianId) return false
  if (raw === 'all') return true
  return raw.split(',').map(s => s.trim()).includes(guardianId)
}
