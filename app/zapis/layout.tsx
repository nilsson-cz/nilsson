import Link from 'next/link'

// app/zapis/layout.tsx
// Veřejný shell pro modul Zápis/Přestup. NA ROZDÍL od /portal NEvyžaduje
// existujícího guardiana — sem přichází i úplně noví rodiče před vznikem
// účtu (registrace přes OTP je součástí flow). Scope „portal-layout" jen
// kvůli sdíleným CSS tokenům (barvy, poloměry) z globals.css.

export default function ZapisLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-layout min-h-screen bg-(--portal-bg) flex flex-col">
      {/* Jednoduchá hlavička (bez navigace portálu — rodič ještě nemusí mít účet) */}
      <header className="border-b border-(--portal-border) bg-(--portal-surface)">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/zapis" className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-(--portal-accent-subtle) text-(--portal-accent) font-semibold">
              V
            </span>
            <span className="text-sm font-semibold text-(--portal-text)">
              ZŠ Vilekula Teplice · Zápis
            </span>
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-4 py-6">{children}</div>
      </main>

      <footer className="border-t border-(--portal-border) bg-(--portal-surface)">
        <div className="max-w-3xl mx-auto px-4 py-4 text-xs text-(--portal-text-subtle)">
          ZŠ Vilekula Teplice · V případě potíží se zápisem kontaktujte školu.
        </div>
      </footer>
    </div>
  )
}
