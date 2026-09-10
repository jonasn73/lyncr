"use client"

import { useRouter } from "next/navigation"
import { AuthPage } from "@/components/auth-pages"
import { resolvePostAuthPath } from "@/lib/post-auth-redirect"

export default function LoginPage() {
  const router = useRouter()
  return (
    <AuthPage
      mode="login"
      onNavigate={(page) => {
        if (page === "landing") router.push("/")
        else if (page === "signup") router.push("/signup")
      }}
      onAuth={(ctx) => {
        if (ctx?.redirect) {
          router.replace(ctx.redirect)
          return
        }
        const next =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("next")
            : null
        router.replace(
          resolvePostAuthPath(
            {
              operator_access: ctx?.operator_access,
              account_status: ctx?.account_status,
              user: {
                email: "",
                account_role: (ctx?.account_role as "owner" | "receptionist") ?? "owner",
                // Admin status here comes from operator_access above, not this fabricated
                // stand-in user — see lib/post-auth-redirect.ts's isAdmin/isOperator split.
                is_platform_admin: false,
              },
            },
            next
          )
        )
      }}
    />
  )
}
