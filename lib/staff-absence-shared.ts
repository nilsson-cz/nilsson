// lib/staff-absence-shared.ts
// Pure typy a popisky evidence nepřítomnosti zaměstnanců (server i client).
// Systém eviduje jen typ + termín; placené/neplacené vyhodnocuje personalista.

export type AbsenceTyp = 'nemoc' | 'ocr' | 'neplacene_volno' | 'studijni_volno' | 'sick_day'

export const ABSENCE_TYP_ORDER: AbsenceTyp[] = [
  'nemoc', 'ocr', 'neplacene_volno', 'studijni_volno', 'sick_day',
]

export const ABSENCE_TYP_LABEL: Record<AbsenceTyp, string> = {
  nemoc: 'Nemoc',
  ocr: 'OČR',
  neplacene_volno: 'Neplacené volno',
  studijni_volno: 'Studijní volno',
  sick_day: 'Sick day',
}

export const ABSENCE_TYP_BADGE: Record<AbsenceTyp, string> = {
  nemoc: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  ocr: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  neplacene_volno: 'bg-gray-100 text-gray-600 dark:bg-stone-800 dark:text-stone-300',
  studijni_volno: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  sick_day: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
}

export type StaffAbsenceRow = {
  id: string
  staff_id: string
  typ: AbsenceTyp
  date_from: string
  date_to: string
  poznamka: string | null
  staff: { first_name: string; last_name: string } | null
}
