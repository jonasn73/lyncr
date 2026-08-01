"use client"

// Ops tools: phone webhook sync, Stripe money fixes, optional sandbox.

import { useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdminSandboxBoard } from "@/components/admin-sandbox-board"
import type { SandboxEnvironment, SandboxIntakeLogRow } from "@/lib/sandbox-engine"
import { cn } from "@/lib/utils"

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
  const [sandboxOpen, setSandboxOpen] = useState(false)

  async function syncTexml() {
    setTexmlBusy(true)
    try {
      const res = await fetch("/api/admin/sync-texml-voice", {
        method: "POST",
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: string }
      if (!res.ok) {
        toast.error(json.error ?? "Phone sync failed")
        return
      }
      toast.success("Phone call routing updated")
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
        toast.error(json.error ?? "Transfer failed")
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
    <div className="mx-auto max-w-3xl space-y-6 p-3 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-50">Finance tools</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fix phone routing and move stuck card payments. Everyday money totals stay on Home.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone system</h2>
        <Card className="border-slate-800 bg-slate-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-100">Update call routing</CardTitle>
            <CardDescription className="text-slate-400">
              Point Lyncr phone numbers at this live app (after a deploy or URL change).
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
              Sync phone routing
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Card payments</h2>
        <Card className="border-slate-800 bg-slate-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-slate-100">Send stuck payment to a business</CardTitle>
            <CardDescription className="text-slate-400">
              Use when a customer paid Lyncr but the business never received their share.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-slate-400">Stripe charge ID</Label>
              <Input
                value={chargeId}
                onChange={(e) => setChargeId(e.target.value)}
                placeholder="ch_…"
                className="border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-400">Business Stripe account</Label>
              <Input
                value={destinationAccountId}
                onChange={(e) => setDestinationAccountId(e.target.value)}
                placeholder="acct_…"
                className="border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
            <Button
              type="button"
              className="bg-violet-600 text-white hover:bg-violet-500"
              disabled={remediateBusy || !chargeId.trim() || !destinationAccountId.trim()}
              onClick={() => void remediate(false)}
            >
              {remediateBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Transfer now
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="border-t border-slate-800 pt-4">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-left text-sm text-slate-400 hover:text-slate-200"
          aria-expanded={sandboxOpen}
          onClick={() => setSandboxOpen((o) => !o)}
        >
          <span>
            <span className="font-medium text-slate-300">Dev sandbox</span>
            <span className="ml-2 text-xs text-slate-500">Optional — test data only</span>
          </span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 transition-transform", sandboxOpen && "rotate-180")}
            aria-hidden
          />
        </button>
        {sandboxOpen ? (
          <div className="mt-3">
            <AdminSandboxBoard
              initialEnvironment={initialEnvironment}
              initialIntakeLogs={initialIntakeLogs}
            />
          </div>
        ) : null}
      </section>
    </div>
  )
}
