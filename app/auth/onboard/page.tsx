"use client"

// Operator onboarding wizard — mic test → backup phone OTP → WebRTC ready state.

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, Loader2, Mic, Phone, ShieldCheck, Sparkles } from "lucide-react"
import type { OperatorAssignedWorkspace, OperatorOnboardingStatus } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useTelnyxWebRtc, WEBRTC_REMOTE_AUDIO_ID } from "@/lib/webrtc/use-telnyx-webrtc"

type Preview = {
  email: string
  name: string
  timezone: string | null
  status: OperatorOnboardingStatus
  assigned_workspaces: OperatorAssignedWorkspace[]
}

export default function OperatorOnboardPage() {
  return (
    <Suspense fallback={<OnboardShell loading />}>
      <OperatorOnboardWizard />
    </Suspense>
  )
}

function OnboardShell({ loading, children }: { loading?: boolean; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#0a0f14] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(52,211,153,0.12),transparent)]" />
      <header className="relative z-10 border-b border-white/5 px-6 py-5">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-lg font-black text-slate-950 shadow-lg shadow-emerald-900/40">
            L
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">Lyncr Operator Network</p>
            <p className="text-xs text-slate-500">Secure provisioning</p>
          </div>
        </div>
      </header>
      <div className="relative z-10 mx-auto w-full max-w-lg flex-1 px-6 py-10">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" aria-hidden />
            Validating your invite…
          </div>
        ) : (
          children
        )}
      </div>
    </main>
  )
}

function StepDots({ step }: { step: number }) {
  const labels = ["Hardware", "Fallback", "Ready"]
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors",
              i <= step ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40" : "bg-slate-800 text-slate-500"
            )}
          >
            {i < step ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          <span className={cn("hidden text-xs sm:inline", i <= step ? "text-slate-300" : "text-slate-600")}>{label}</span>
          {i < labels.length - 1 ? <span className="h-px w-6 bg-slate-700" aria-hidden /> : null}
        </div>
      ))}
    </div>
  )
}

function OperatorOnboardWizard() {
  const router = useRouter()
  const search = useSearchParams()
  const token = search.get("token")?.trim() || ""

  const [preview, setPreview] = useState<Preview | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [micOk, setMicOk] = useState(false)
  const [phone, setPhone] = useState("")
  const [otpSent, setOtpSent] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [otp, setOtp] = useState("")
  const [password, setPassword] = useState("")
  const [activated, setActivated] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  const web = useTelnyxWebRtc({ enabled: activated })

  useEffect(() => {
    if (!token) {
      setInvalid(true)
      return
    }
    let active = true
    fetch(`/api/auth/onboard?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { data?: Preview & { valid?: boolean }; error?: string }) => {
        if (!active) return
        if (j.data?.valid) {
          setPreview({
            email: j.data.email,
            name: j.data.name,
            timezone: j.data.timezone,
            status: j.data.status,
            assigned_workspaces: j.data.assigned_workspaces ?? [],
          })
          if (j.data.status === "ACTIVE_READY") setActivated(true)
          else if (j.data.status === "DEVICE_TESTING") setStep(1)
          else setStep(0)
        } else {
          setInvalid(true)
        }
      })
      .catch(() => active && setInvalid(true))
    return () => {
      active = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [token])

  const runMicTest = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setMicOk(true)
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "device-tested", token }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Could not save device check")
      setStep(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone access is required to answer in-browser.")
    } finally {
      setBusy(false)
    }
  }, [token])

  async function sendOtp() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-otp", token, phone }),
      })
      const json = (await res.json()) as { data?: { dev_code?: string }; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not send code")
      setOtpSent(true)
      setDevCode(json.data?.dev_code ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send verification code")
    } finally {
      setBusy(false)
    }
  }

  async function verifyAndFinish() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "verify-otp",
          token,
          code: otp,
          password,
          name: preview?.name,
          prefer_web_routing: micOk,
        }),
      })
      const json = (await res.json()) as { data?: { redirect?: string }; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Activation failed")
      setActivated(true)
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activation failed")
    } finally {
      setBusy(false)
    }
  }

  if (invalid) {
    return (
      <OnboardShell>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="font-semibold text-red-100">This invite link is invalid or has expired.</p>
          <p className="mt-2 text-sm text-red-200/80">Ask Lyncr platform admin to send a fresh invite.</p>
        </div>
      </OnboardShell>
    )
  }

  if (!preview) {
    return <OnboardShell loading />
  }

  return (
    <OnboardShell>
      <StepDots step={step} />

      <div className="rounded-2xl border border-white/8 bg-slate-950/60 p-6 shadow-xl backdrop-blur-sm">
        <p className="text-center text-sm text-slate-400">
          Welcome, <span className="font-medium text-slate-200">{preview.name.split(" ")[0] || "operator"}</span>
        </p>
        {preview.assigned_workspaces.length > 0 ? (
          <p className="mt-2 text-center text-xs text-emerald-300/90">
            Cleared for: {preview.assigned_workspaces.map((w) => w.business_name).join(", ")}
          </p>
        ) : null}

        {step === 0 ? (
          <div className="mt-6 space-y-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
                <Mic className="h-7 w-7 text-emerald-300" aria-hidden />
              </span>
              <h1 className="text-xl font-semibold">Step 1 · Hardware check</h1>
              <p className="text-sm text-slate-400">
                Allow microphone access so we can verify your browser is ready for WebRTC call answering.
              </p>
            </div>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <Button
              type="button"
              className="w-full bg-emerald-600 hover:bg-emerald-500"
              disabled={busy}
              onClick={() => void runMicTest()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
              Test microphone
            </Button>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-6 space-y-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 ring-1 ring-sky-500/30">
                <Phone className="h-7 w-7 text-sky-300" aria-hidden />
              </span>
              <h1 className="text-xl font-semibold">Step 2 · Fallback binding</h1>
              <p className="text-sm text-slate-400">
                Add your mobile number and verify with a one-time code. This is your backup when WebRTC is unavailable.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-phone" className="text-slate-300">
                Mobile number
              </Label>
              <Input
                id="backup-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(502) 555-0100"
                className="border-slate-700 bg-slate-900/80"
              />
            </div>
            {!otpSent ? (
              <Button type="button" className="w-full" variant="secondary" disabled={busy} onClick={() => void sendOtp()}>
                Send verification code
              </Button>
            ) : (
              <>
                {devCode ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-center text-xs text-amber-100">
                    Dev code: <strong>{devCode}</strong>
                  </p>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="otp" className="text-slate-300">
                    SMS code
                  </Label>
                  <Input
                    id="otp"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    className="border-slate-700 bg-slate-900/80"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-300">
                    Create password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="border-slate-700 bg-slate-900/80"
                  />
                </div>
                <Button
                  type="button"
                  className="w-full bg-emerald-600 hover:bg-emerald-500"
                  disabled={busy}
                  onClick={() => void verifyAndFinish()}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Verify & activate
                </Button>
              </>
            )}
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-6 space-y-5 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 ring-2 ring-emerald-400/50">
              <Sparkles className="h-8 w-8 text-emerald-300" aria-hidden />
            </span>
            <h1 className="text-xl font-semibold text-emerald-100">You&apos;re active & ready</h1>
            <p className="text-sm text-slate-400">
              WebRTC status:{" "}
              <span className="font-medium text-slate-200">
                {web.status === "registered" || web.status === "active"
                  ? "Connected"
                  : web.status === "connecting"
                    ? "Connecting…"
                    : web.status === "not_provisioned"
                      ? "Cell fallback enabled"
                      : web.status}
              </span>
            </p>
            <audio id={WEBRTC_REMOTE_AUDIO_ID} autoPlay playsInline className="sr-only" />
            <Button type="button" className="w-full bg-emerald-600 hover:bg-emerald-500" onClick={() => router.replace("/receptionist")}>
              Open operator console
            </Button>
          </div>
        ) : null}
      </div>
    </OnboardShell>
  )
}
