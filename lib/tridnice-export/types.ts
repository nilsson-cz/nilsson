// lib/tridnice-export/types.ts
// Datový model PDF exportu třídní knihy (po třídách, za období od–do).
// Plní lib/tridnice-export/gather.ts, vykresluje lib/tridnice-export/pdf.tsx.

export type ExportPedagog = {
  jmeno: string;
  role: string;
  predmety: string[]; // odvozeno z ŠVP výstupů dnů, kdy osoba v třídě učila
};

export type ExportZak = {
  cislo: number;
  jmeno: string; // „Příjmení Jméno"
  rocnik: number | null;
  nastup: string | null; // ISO; jen když nastoupil(a) po začátku období/roku
  poznamka: string | null; // odchod, změna způsobu plnění PŠD
};

export type ExportBlok = {
  cas_od: string;
  cas_do: string;
  nazev: string;
  obsah: string | null;
};

export type ExportDochazka = {
  cislo: number;
  jmeno: string;
  rocnik: number | null;
  absenceHod: number | null; // zameškané hodiny (null = přítomen / bez záznamu)
  poznamka: string | null; // stav/důvod, „mimo evidenci" apod.
};

export type ExportSvpRocnik = {
  rocnik: number;
  predmety: { predmet: string; vystupy: string[] }[];
};

export type ExportDen = {
  id: string;
  datum: string;
  typ: string;
  nazev: string;
  popis: string | null;
  pruvodci: string[];
  bloky: ExportBlok[];
  dochazka: ExportDochazka[];
  svp: ExportSvpRocnik[];
  poznamky: string[];
};

export type TridniceExportData = {
  trida: string;
  skolniRok: string;
  od: string;
  do: string;
  vytvoreno: string;
  pedagogove: ExportPedagog[];
  zaci: ExportZak[];
  dny: ExportDen[];
  nedoplneneDny: string[];
};
