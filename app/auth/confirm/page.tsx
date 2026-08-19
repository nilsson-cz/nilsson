"use client"

// app/auth/confirm/page.tsx
// ZpracovĂˇnĂ­ magic link tokenu.
// Supabase mĹŻĹľe poslat dva typy token_hash:
//   - pkce_...  â†’ PKCE flow â†’ exchangeCodeForSession()
//   - ostatnĂ­   â†’ plain flow â†’ verifyOtp()

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createBrowserClient } from "@supabase/ssr"

function ConfirmInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const token_hash = searchParams.get("token_hash")
    const type       = searchParams.get("type") ?? "magiclink"
    const next       = searchParams.get("next") ?? "/portal/omluvenky"

    if (!token_hash) {
      router.replace("/auth/error?reason=missing_token")
      return
    }

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const verify = token_hash.startsWith("pkce_")
      ? supabase.auth.exchangeCodeForSession(token_hash)
      : supabase.auth.verifyOtp({ token_hash, type: type as "magiclink" | "email" })

    verify.then(({ error }) => {
      if (error) {
        console.error("auth confirm error:", error.message, error.status, error)
        router.replace(`/auth/error?reason=invalid_token&msg=${encodeURIComponent(error.message)}`)
      } else {
        router.replace(next)
      }
    })
  }, [])

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <p style={{ color: "#666", fontSize: "14px" }}>PĹ™ihlaĹˇuji...</p>
    </div>
  )
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div />}>
      <ConfirmInner />
    </Suspense>
  )
}
