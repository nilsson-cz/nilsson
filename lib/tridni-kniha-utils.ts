export type DenVTydnu = 'po' | 'út' | 'st' | 'čt' | 'pá';

export function computeDenVTydnu(dateStr: string): DenVTydnu | null {
  const map: Record<number, DenVTydnu> = {
    1: 'po', 2: 'út', 3: 'st', 4: 'čt', 5: 'pá',
  };
  return map[new Date(`${dateStr}T12:00:00`).getDay()] ?? null;
}