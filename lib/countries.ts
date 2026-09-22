// lib/countries.ts
// Seznam zemí pro výběr adresy. Držíme jen ISO 3166-1 alpha-2 kódy; lidský název
// se lokalizuje za běhu přes Intl.DisplayNames('cs') (funguje v prohlížeči i v Node,
// takže stejný helper jde použít na klientu i na serveru — např. formátování adresy
// do PDF). CZ je default a drží se nahoře seznamu.

export const CZ = 'CZ'

// ISO 3166-1 alpha-2 (bez CZ; CZ se přidává zvlášť nahoru).
export const COUNTRY_CODES: string[] = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS',
  'BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN',
  'CO','CR','CU','CV','CW','CX','CY','DE','DJ','DK','DM','DO','DZ','EC','EE','EG',
  'EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG',
  'GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN',
  'HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO',
  'JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI',
  'LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML',
  'MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC',
  'NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH',
  'PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA',
  'SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST',
  'SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR',
  'TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN',
  'VU','WF','WS','YE','YT','ZA','ZM','ZW',
]

export interface Country {
  code: string
  name: string
}

/**
 * Lokalizovaný název země z ISO kódu. Fallback = samotný kód, kdyby prostředí
 * Intl.DisplayNames nepodporovalo.
 */
export function countryName(code: string | null | undefined): string {
  if (!code) return ''
  try {
    const dn = new Intl.DisplayNames(['cs'], { type: 'region' })
    return dn.of(code) ?? code
  } catch {
    return code
  }
}

/**
 * Seznam zemí pro <select>: CZ první, zbytek abecedně podle českého názvu.
 */
export function countryOptions(): Country[] {
  let dn: Intl.DisplayNames | null = null
  try {
    dn = new Intl.DisplayNames(['cs'], { type: 'region' })
  } catch {
    dn = null
  }
  const nazev = (c: string) => (dn ? dn.of(c) ?? c : c)
  const rest = COUNTRY_CODES.map((code) => ({ code, name: nazev(code) })).sort((a, b) =>
    a.name.localeCompare(b.name, 'cs'),
  )
  return [{ code: CZ, name: nazev(CZ) }, ...rest]
}
