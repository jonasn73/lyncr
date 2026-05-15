"use client"

import { useRouter } from "next/navigation"
import { AuthPage } from "@/components/auth-pages"

/** Safe post-login path: operators go to `/admin` (or `?next=` if under `/admin`). */
function postLoginPath(operator: boolean): string {
  if (typeof window === "undefined") return operator ? "/admin" : "/dashboard"
  const next = new URLSearchParams(window.location.search).get("next")
  if (operator) {
    if (next && next.startsWith("/admin")) return next
    return "/admin"
  }
  if (next && next.startsWith("/dashboard")) return next
  return "/dashboard"
}

export default function LoginPage() {
  const router = useRouter()
  return (
    <AuthPage
      mode="login"
      onNavigate={(page) => {
        if (page === "landing") router.push("/")
        else if (page === "signup") router.push("/signup")
      }}
      onAuth={(ctx) => router.replace(postLoginPath(Boolean(ctx?.operator_access)))}
    />
  )
}
