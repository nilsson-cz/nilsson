// lib/vp-shared.ts
// Sdílené typy a konstanty VP modulu.
// Importovatelné z Client i Server Components — bez Supabase závislostí.

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export type TypVpPece = 'watch' | 'po_1' | 'po_2' | 'po_3' | 'po_4' | 'po_5'
export type VpStatus  = 'active' | 'closed' | 'transferred'

export type DokumentKey =
  | 'doporuceni_spz'
  | 'souhlas_zz'
  | 'ivp'
  | 'plpp'
  | 'hodnoceni_ivp'
  | 'zprava_psychiatrie'
  | 'zprava_psychologie'
  | 'zprava_neurologie'
  | 'soudni_prikaz_ospod'
  | 'jine'

export interface DokumentItem {
  exists:      boolean
  valid_until: string | null  // ISO date 'YYYY-MM-DD' nebo null
  in_private:  boolean
  poznamka?:   string | null  // pouze pro klíč 'jine'
}

export type DokumentyMap = Partial<Record<DokumentKey, DokumentItem>>

export interface VpStudentCare {
  id:                 string
  student_id:         string
  school_year:        string
  typ_pece:           TypVpPece
  status:             VpStatus
  spz_valid_until:    string | null
  spz_review_due:     string | null
  ivp_required:       boolean
  ivp_evaluated_at:   string | null
  drive_url_public:   string | null
  drive_url_private:  string | null  // null pro guide/assistant (filtrováno v lib/vp.ts)
  dokumenty:          DokumentyMap
  poznamka:           string | null
  started_at:         string
  closed_at:          string | null
  created_by:         string
  created_at:         string
  updated_at:         string
}

// Varianta bez citlivých polí — pro guide a assistant
export type VpStudentCarePublic = Omit<VpStudentCare, 'drive_url_private'> & {
  drive_url_private: null
}

// ---------------------------------------------------------------------------
// Konstanty checklistu
// ---------------------------------------------------------------------------

export interface DokumentMeta {
  label:            string
  default_private:  boolean   // true = defaultně do privátní složky
  has_expiry:       boolean   // true = má lhůtu platnosti
}

export const DOKUMENT_META: Record<DokumentKey, DokumentMeta> = {
  doporuceni_spz:       { label: 'Doporučení ŠPZ',                    default_private: false, has_expiry: true  },
  souhlas_zz:           { label: 'Souhlas zákonného zástupce',        default_private: false, has_expiry: false },
  ivp:                  { label: 'IVP (individuální vzdělávací plán)', default_private: false, has_expiry: false },
  plpp:                 { label: 'PLPP (plán pedagogické podpory)',    default_private: false, has_expiry: false },
  hodnoceni_ivp:        { label: 'Hodnocení IVP',                     default_private: false, has_expiry: true  },
  zprava_psychiatrie:   { label: 'Zpráva z psychiatrie',              default_private: true,  has_expiry: false },
  zprava_psychologie:   { label: 'Zpráva z psychologie',              default_private: true,  has_expiry: false },
  zprava_neurologie:    { label: 'Zpráva z neurologie',               default_private: true,  has_expiry: false },
  soudni_prikaz_ospod:  { label: 'Soudní příkaz / OSPOD',            default_private: true,  has_expiry: false },
  jine:                 { label: 'Jiné',                               default_private: false, has_expiry: false },
}

export const DOKUMENT_KEYS = Object.keys(DOKUMENT_META) as DokumentKey[]

// ---------------------------------------------------------------------------
// Popisky
// ---------------------------------------------------------------------------

export const TYP_PECE_LABEL: Record<TypVpPece, string> = {
  watch: 'Sledování',
  po_1:  'PO stupeň 1',
  po_2:  'PO stupeň 2',
  po_3:  'PO stupeň 3',
  po_4:  'PO stupeň 4',
  po_5:  'PO stupeň 5',
}

export const VP_STATUS_LABEL: Record<VpStatus, string> = {
  active:      'Aktivní',
  closed:      'Uzavřeno',
  transferred: 'Přeřazen',
}

// ---------------------------------------------------------------------------
// Pure funkce
// ---------------------------------------------------------------------------

/** Vrátí true pokud typ péče vyžaduje doporučení ŠPZ */
export function requiresSpz(typ: TypVpPece): boolean {
  return ['po_2', 'po_3', 'po_4', 'po_5'].includes(typ)
}

/** Vrátí výchozí DokumentItem pro daný klíč */
export function defaultDokumentItem(key: DokumentKey): DokumentItem {
  const meta = DOKUMENT_META[key]
  return {
    exists:      false,
    valid_until: null,
    in_private:  meta.default_private,
    ...(key === 'jine' ? { poznamka: null } : {}),
  }
}

/** Odfiltruje in_private dokumenty z DokumentyMap pro guide/assistant */
export function filterPrivateDokumenty(dokumenty: DokumentyMap): DokumentyMap {
  const result: DokumentyMap = {}
  for (const key of DOKUMENT_KEYS) {
    const item = dokumenty[key]
    if (item && !item.in_private) {
      result[key] = item
    }
  }
  return result
}
