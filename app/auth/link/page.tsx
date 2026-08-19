"use client"

// app/auth/link/page.tsx
// Mezistránka mezi emailovým klientem a /auth/confirm.
// Emailoví klienti (Gmail, Outlook) automaticky prefetchují/preklíkávají
// odkazy v emailu — pokud by odkaz vedl přímo na /auth/confirm, token
// by se spotřeboval ještě před uživatelem.
// Tato stránka je statická (žádný useEffect, žádné volání Supabase) —
// zobrazí jen tlačítko. Token se aktivuje až kliknutím uživatele.

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"

function LinkInner() {
  const searchParams = useSearchParams()

  const token_hash = searchParams.get("token_hash") ?? ""
  const type       = searchParams.get("type")       ?? "magiclink"
  const next       = searchParams.get("next")       ?? "/portal/omluvenky"

  if (!token_hash) {
    return (
      <div style={styles.container}>
        <p style={styles.error}>Neplatný odkaz. Požádejte o nový přihlašovací email.</p>
      </div>
    )
  }

  const confirmUrl =
    `/auth/confirm?token_hash=${encodeURIComponent(token_hash)}&type=${encodeURIComponent(type)}&next=${encodeURIComponent(next)}`

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.heading}>Přihlášení do portálu ZŠ Vilekula</h2>
        <p style={styles.text}>
          Kliknutím na tlačítko níže se přihlásíte do rodičovského portálu.
        </p>
        <Link href={confirmUrl} style={styles.button}>
          Přihlásit se
        </Link>
        <p style={styles.note}>
          Odkaz je platný 1 hodinu a lze ho použít pouze jednou.
        </p>
      </div>
    </div>
  )
}

export default function LinkPage() {
  return (
    <Suspense fallback={<div />}>
      <LinkInner />
    </Suspense>
  )
}

// ─── Inline styly (bez závislosti na Tailwindu, stránka je mimo dashboard layout) ───

const styles = {
  container: {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    minHeight:      "100vh",
    background:     "#f9fafb",
    padding:        "24px",
  } as React.CSSProperties,
  card: {
    background:   "#fff",
    borderRadius: "12px",
    border:       "1px solid #e5e7eb",
    padding:      "40px 32px",
    maxWidth:     "420px",
    width:        "100%",
    textAlign:    "center",
  } as React.CSSProperties,
  heading: {
    fontSize:     "18px",
    fontWeight:   "600",
    color:        "#111827",
    marginBottom: "12px",
    fontFamily:   "sans-serif",
  } as React.CSSProperties,
  text: {
    fontSize:     "14px",
    color:        "#6b7280",
    marginBottom: "28px",
    fontFamily:   "sans-serif",
    lineHeight:   "1.5",
  } as React.CSSProperties,
  button: {
    display:        "inline-block",
    background:     "#1a56db",
    color:          "#fff",
    padding:        "12px 28px",
    borderRadius:   "8px",
    textDecoration: "none",
    fontWeight:     "500",
    fontSize:       "15px",
    fontFamily:     "sans-serif",
  } as React.CSSProperties,
  note: {
    fontSize:   "12px",
    color:      "#9ca3af",
    marginTop:  "24px",
    fontFamily: "sans-serif",
  } as React.CSSProperties,
  error: {
    fontSize:   "14px",
    color:      "#dc2626",
    fontFamily: "sans-serif",
  } as React.CSSProperties,
}
