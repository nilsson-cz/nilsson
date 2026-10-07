// lib/staty-rast.ts
// Názvy států podle číselníku RAST pro zobrazení (výkaz Z 2-01, oddíl XXI).
// Výpis nejčastějších států z metodického pokynu Z 2-01 (2025) + ČR; plný
// číselník je v pořizovacím programu sberdat. Neznámý kód se zobrazí jako kód.

export const NAZVY_STATU: Record<string, string> = {
  '203': 'Česká republika',
  '008': 'Albánie', '051': 'Arménie', '031': 'Ázerbájdžán', '056': 'Belgie', '112': 'Bělorusko',
  '070': 'Bosna a Hercegovina', '076': 'Brazílie', '100': 'Bulharsko', '156': 'Čína', '818': 'Egypt',
  '233': 'Estonsko', '608': 'Filipíny', '250': 'Francie', '191': 'Chorvatsko', '356': 'Indie',
  '368': 'Irák', '372': 'Irsko', '380': 'Itálie', '376': 'Izrael', '710': 'Jižní Afrika',
  '398': 'Kazachstán', '410': 'Korejská republika', '095': 'Kosovo', '417': 'Kyrgyzstán',
  '440': 'Litva', '428': 'Lotyšsko', '348': 'Maďarsko', '498': 'Moldavsko', '496': 'Mongolsko',
  '276': 'Německo', '524': 'Nepál', '566': 'Nigérie', '528': 'Nizozemsko', '586': 'Pákistán',
  '616': 'Polsko', '620': 'Portugalsko', '040': 'Rakousko', '642': 'Rumunsko', '643': 'Rusko',
  '300': 'Řecko', '807': 'Severní Makedonie', '703': 'Slovensko', '840': 'Spojené státy',
  '688': 'Srbsko', '760': 'Sýrie', '724': 'Španělsko', '764': 'Thajsko', '792': 'Turecko',
  '804': 'Ukrajina', '860': 'Uzbekistán', '826': 'Velká Británie', '704': 'Vietnam',
}

export function nazevStatu(kod: string): string {
  return NAZVY_STATU[kod] ?? (kod === '???' ? 'neznámé občanství' : `kód ${kod}`)
}
