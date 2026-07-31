"use client"

// Ops tools: Telnyx TeXML sync, Stripe charge remediation, sandbox environment.

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdminSandboxBoard } from "@/components/admin-sandbox-board"
import type { SandboxEnvironment, SandboxIntakeLogRow } from "@/lib/sandbox-engine"

export function AdminToolsBoard({
  initialEnvironment,
  initialIntakeLogs,
}: {
  initialEnvironment: SandboxEnvironment | null
  initialIntakeLogs: SandboxIntakeLogRow[]
}) {
  const [texmlBusy, setTexmlBusy] = useState(false)
  const [remediateBusy, setRemediateBusy] = useState(false)
  const [chargeId, setChargeId] = useState("")
  const [destinationAccountId, setDestinationAccountId] = useState("")

  async function syncTexml() {
    setTexmlBusy(true)
    try {
      const res = await fetch("/api/admin/sync-texml-voice", {
        method: "POST",
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: string }
      if (!res.ok) {
        toast.error(json.error ?? "TeXML sync failed")
        return
      }
      toast.success("TeXML / Call Control apps synced")
      console.info("[admin tools] sync-texml-voice", json.data)
    } finally {
      setTexmlBusy(false)
    }
  }

  async function remediate(useMichaelPreset: boolean) {
    setRemediateBusy(true)
    try {
      const body = useMichaelPreset
        ? { useMichaelPreset: true }
        : {
            chargeId: chargeId.trim(),
            destinationAccountId: destinationAccountId.trim(),
          }
      const res = await fetch("/api/admin/remediate-platform-charge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { status?: string; amountDollars?: string }
        error?: string
      }
      if (!res.ok) {
        toast.error(json.error ?? "Remediation failed")
        return
      }
      toast.success(
        json.data?.status === "already_transferred"
          ? "Already transferred"
          : `Transferred $${json.data?.amountDollars ?? "?"}`
      )
    } finally {
      setRemediateBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-3 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-50">Tools</h1>
        <p className="mt-1 text-sm text-slate-500">
          Platform ops actions and the dev sandbox. Porting webhook setup still uses{" "}
          <code className="text-violet-200">PORTING_WEBHOOK_SECRET</code> via curl — not session auth.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-800 bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-base text-slate-100">Sync TeXML voice</CardTitle>
            <CardDescription className="text-slate-400">
              Point Telnyx Call Router / TeXML app at the current app URL greeting + routing webhooks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              className="bg-violet-600 text-white hover:bg-violet-500"
              disabled={texmlBusy}
              onClick={() => void syncTexml()}
            >
              {texmlBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sync now
            </Button>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-base text-slate-100">Remediate platform charge</CardTitle>
            <CardDescription className="text-slate-400">
              Move stranded Stripe platform charge net funds to a Connect account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-slate-400">Charge ID</Label>
              <Input
                value={chargeId}
                onChange={(e) => setChargeId(e.target.value)}
                placeholder="ch_…"
                className="border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-400">Connect account</Label>
              <Input
                value={destinationAccountId}
                onChange={(e) => setDestinationAccountId(e.target.value)}
                placeholder="acct_…"
                className="border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-slate-600 text-slate-200"
                disabled={remediateBusy || !chargeId.trim() || !destinationAccountId.trim()}
                onClick={() => void remediate(false)}
              >
                Transfer
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={remediateBusy}
                onClick={() => void remediate(true)}
              >
                Michael preset
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="border-t border-slate-800 pt-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">Dev sandbox</h2>
        <AdminSandboxBoard
          initialEnvironment={initialEnvironment}
          initialIntakeLogs={initialIntakeLogs}
        />
      </div>
    </div>
  )
}
