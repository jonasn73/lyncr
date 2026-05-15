"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { SITE_NAME } from "@/lib/brand"
import { SIGNUP_INDUSTRY_OPTIONS } from "@/lib/business-industries"
import { Phone, Eye, EyeOff, Loader2 } from "lucide-react"

interface AuthPageProps {
  mode: "login" | "signup"
  onNavigate: (page: string) => void
  /** Called after successful login or signup; `operator_access` means redirect to `/admin` instead of dashboard. */
  onAuth: (ctx?: { operator_access: boolean }) => void
}

export function AuthPage({ mode, onNavigate, onAuth }: AuthPageProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [businessName, setBusinessName] = useState("")
  const [ownerName, setOwnerName] = useState("")
  const [ownerPhone, setOwnerPhone] = useState("")
  const [industry, setIndustry] = useState("generic")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const isSignup = mode === "signup"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      if (isSignup) {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name: ownerName,
            phone: ownerPhone,
            business_name: businessName || "My Business",
            industry,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || "Signup failed")
          setLoading(false)
          return
        }
        onAuth({ operator_access: Boolean(data?.data?.operator_access) })
      } else {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || "Login failed")
          setLoading(false)
          return
        }
        onAuth({ operator_access: Boolean(data?.data?.operator_access) })
      }
    } catch {
      setError("Something went wrong. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Logo */}
      <header className="flex items-center justify-center px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Phone className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-base font-bold text-foreground">{SITE_NAME}</span>
        </div>
      </header>

      {/* Form */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-foreground">
              {isSignup ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isSignup
                ? "Use your cell as your main line. Add a business number to port or buy after signup."
                : "Log in to manage your calls"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {isSignup && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="businessName" className="text-xs font-semibold text-muted-foreground">
                    Business Name
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    placeholder="Acme Plumbing"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    required
                    className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ownerName" className="text-xs font-semibold text-muted-foreground">
                    Your Name
                  </label>
                  <input
                    id="ownerName"
                    type="text"
                    placeholder="John Smith"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    required
                    className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ownerPhone" className="text-xs font-semibold text-muted-foreground">
                    Your cell phone (main line)
                  </label>
                  <input
                    id="ownerPhone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    required
                    className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Calls will ring here by default. Add a business number (buy or port) in Settings after signup.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="industry" className="text-xs font-semibold text-muted-foreground">
                    Industry
                  </label>
                  <select
                    id="industry"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    required
                    className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                  >
                    {SIGNUP_INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Used to tailor your AI phone assistant when nobody answers (questions match your trade).
                  </p>
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-xs font-semibold text-muted-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-xs font-semibold text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={isSignup ? "Create a password" : "Enter your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={isSignup ? 8 : 1}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  className="w-full rounded-lg border border-border bg-card px-3.5 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {!isSignup && (
                <button
                  type="button"
                  className="self-end text-xs text-primary hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isSignup ? (
                "Create Account"
              ) : (
                "Log In"
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              onClick={() => onNavigate(isSignup ? "login" : "signup")}
              className="font-medium text-primary hover:underline"
            >
              {isSignup ? "Log in" : "Sign up"}
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
