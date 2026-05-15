"use client"

import { useRouter } from "next/navigation"
import { AuthPage } from "@/components/auth-pages"

export default function SignupPage() {
  const router = useRouter()
  return (
    <AuthPage
      mode="signup"
      onNavigate={(page) => {
        if (page === "landing") router.push("/")
        else if (page === "login") router.push("/login")
        else if (page === "onboarding") router.push("/dashboard")
      }}
      onAuth={(ctx) => router.push(ctx?.operator_access ? "/admin" : "/dashboard")}
    />
  )
}
