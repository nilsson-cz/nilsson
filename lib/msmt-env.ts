// lib/msmt-env.ts
// Identifikátory školy pro MŠMT z env proměnných — vždy ořezané.
//
// Hodnota vložená do Vercelu s bílým znakem na konci (mezera, nový řádek) nebo
// s komentářem („691012868    # nebo stejné jako IZO" jako v .env.local) se
// jinak dostala do XML (IZO="250002639\n") i do názvu souboru, kde ji prohlížeč
// nahradil podtržítkem (Z250002639__01.xml).

function envValue(name: string): string | undefined {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const v = raw.replace(/\s+#[\s\S]*$/, '').trim()
  return v === '' ? undefined : v
}

export function msmtEnv() {
  const izo = envValue('MSMT_IZO') ?? ''
  return {
    izo,
    // RED_IZO = jediný zdroj SCHOOL_RED_IZO (jako PDF zápisu, katalogového listu,
    // úrazů). MSMT_RED_IZO se nečte — měla chybnou hodnotu 691012868 (2026-09-28).
    redIzo:     (envValue('SCHOOL_RED_IZO') ?? '691018901').replace(/\s/g, ''),
    druhSkoly:  envValue('MSMT_DRUH_SKOLY') ?? 'B00',
    typSkoly:   envValue('MSMT_TYP_SKOLY') ?? '2',
    inspisIzo:  envValue('INSPIS_IZO') ?? izo,
    // Telefon do hlavičky MŠMT XML (<telefon>) — staff telefon neeviduje.
    telefon:    envValue('MSMT_TELEFON') ?? '',
  }
}
