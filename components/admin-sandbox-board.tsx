"use client"

// Internal dev sandbox board — seed DB, simulate calls, inspect intake dispatches.

import { useCallback, useState, useTransition } from "react"
import Link from "next/link"
import {
  Database,
  KeyRound,
  Loader2,
  PhoneIncoming,
  RefreshCw,
  ScrollText,
  Shield,
  Zap,
} from "lucide-react"
import { toast } from "sonner"
import type { SandboxEnvironment, SandboxIntakeLogRow } from "@/lib/sandbox-engine"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Props = {
  initialEnvironment: SandboxEnvironment | null
  initialIntakeLogs: SandboxIntakeLogRow[]
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

export function AdminSandboxBoard({ initialEnvironment, initialIntakeLogs }: Props) {
  const [environment, setEnvironment] = useState(initialEnvironment)
  const [intakeLogs, setIntakeLogs] = useState(initialIntakeLogs)
  const [pending, startTransition] = useTransition()
  const [quickSwitchBusy, setQuickSwitchBusy] = useState(false)
  const [quickSwitchError, setQuickSwitchError] = useState<string | null>(null)
  const [seedWarnings, setSeedWarnings] = useState<string[]>([])
  const [lastAction, setLastAction] = useState<string | null>(null)

  const refreshLogs = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/sandbox/intake-logs?limit=30", {
          credentials: "include",
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: SandboxIntakeLogRow[]
        }
        if (!res.ok) {
          toast.error(json.error || "Could not refresh intake logs")
          return
        }
        setIntakeLogs(json.data ?? [])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not refresh intake logs")
      }
    })
  }, [])

  function handleSeed() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/sandbox/seed", {
          method: "POST",
          credentials: "include",
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: {
            environment: SandboxEnvironment
            message: string
            warnings: string[]
            sample_intake_sms?: {
              sent: boolean
              error: string | null
              telnyx_message_id: string | null
              from: string | null
              to: string | null
            } | null
          }
        }
        if (!res.ok) {
          toast.error(json.error || "Sandbox seed failed")
          return
        }
        const result = json.data
        if (!result) {
          toast.error("Sandbox seed returned no data")
          return
        }
        setEnvironment(result.environment)
        setLastAction(result.message)
        setSeedWarnings(result.warnings ?? [])
        const sms = result.sample_intake_sms
        if (sms?.sent && sms.error) {
          toast.warning(
            `Telnyx accepted the lead SMS but it may not reach your phone yet. ${sms.error}`
          )
        } else if (sms?.sent) {
          toast.success(
            `Lead SMS queued: ${sms.from ?? "?"} → ${sms.to ?? "?"}${sms.telnyx_message_id ? ` (${sms.telnyx_message_id})` : ""}`
          )
        } else if (sms?.error) {
          toast.error(`Lead SMS failed: ${sms.error}`)
        } else if (result.warnings.length > 0) {
          toast.warning("Sandbox seeded — see notes banner below.")
        } else {
          toast.success("Sandbox environment seeded")
        }
        refreshLogs()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sandbox seed failed unexpectedly")
      }
    })
  }

  async function handleQuickSwitch() {
    setQuickSwitchBusy(true)
    setQuickSwitchError(null)
    try {
      const res = await fetch("/api/admin/sandbox/quick-switch", {
        method: "POST",
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { redirect?: string }
      }
      if (!res.ok) {
        const message = json.error || "Quick-switch failed"
        setQuickSwitchError(message)
        toast.error(message)
        return
      }
      window.location.href = json.data?.redirect ?? "/receptionist/training/automotive_core"
    } catch (e) {
      const message = e instanceof Error ? e.message : "Quick-switch failed unexpectedly"
      setQuickSwitchError(message)
      toast.error(message)
    } finally {
      setQuickSwitchBusy(false)
    }
  }

  function handleMockCall() {
    const lineId = environment?.business_line_id
    if (!lineId) {
      toast.error("Run DB Environment Seed first — no business line id yet.")
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/sandbox/mock-call", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessLineId: lineId }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: {
            message: string
            notified_receptionists: { id: string; name: string }[]
            duration_seconds: number
            sms_sent: boolean
            sms_error: string | null
            sms_from: string | null
            sms_to: string | null
          }
        }
        if (!res.ok) {
          toast.error(json.error || "Mock call failed")
          return
        }
        const result = json.data
        if (!result) {
          toast.error("Mock call returned no data")
          return
        }
        setLastAction(result.message)
        const count = result.notified_receptionists.length
        if (result.sms_sent && result.sms_error) {
          toast.warning(
            `Logged a ${result.duration_seconds}s call to ${count} receptionist(s). Lead SMS accepted by Telnyx but delivery may be blocked.`
          )
        } else if (result.sms_sent) {
          toast.success(
            `Logged a ${result.duration_seconds}s call to ${count} receptionist(s) — lead SMS queued.`
          )
        } else {
          toast.success(`Logged a ${result.duration_seconds}s call to ${count} receptionist(s).`)
        }
        refreshLogs()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Mock call failed unexpectedly")
      }
    })
  }

  function handleRepairSms() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/sandbox/repair-sms", {
          method: "POST",
          credentials: "include",
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          data?: {
            sms_from: string | null
            dispatch_to: string
            test_sent: boolean
            test_error: string | null
            telnyx_message_id: string | null
            delivery_warning: string | null
            setup_warnings: string[]
          }
        }
        if (!res.ok) {
          toast.error(json.error || "SMS repair failed")
          return
        }
        const result = json.data
        if (!result) {
          toast.error("SMS repair returned no data")
          return
        }
        if (result.test_sent && result.delivery_warning) {
          toast.warning(
            `Telnyx accepted test SMS (${result.sms_from ?? "?"} → ${result.dispatch_to}) but delivery may be blocked: ${result.delivery_warning}`
          )
        } else if (result.test_sent) {
          toast.success(
            `Test SMS queued: ${result.sms_from ?? "Telnyx line"} → ${result.dispatch_to}${result.telnyx_message_id ? ` (${result.telnyx_message_id})` : ""}`
          )
        } else {
          toast.error(result.test_error || "Test SMS failed")
        }
        if (result.setup_warnings.length > 0) {
          setSeedWarnings(result.setup_warnings)
        }
        if (environment) {
          setEnvironment({
            ...environment,
            sms_leads_enabled: true,
            dispatch_sms_phone: result.dispatch_to,
          })
        }
        refreshLogs()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "SMS repair failed unexpectedly")
      }
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="border-operator/40 bg-operator/10 text-operator">
              <Shield className="mr-1 h-3 w-3" aria-hidden />
              Dev only
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Developer sandbox</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            End-to-end testing for call routing, receptionist HUD, automotive_core quiz, and SMS intake dispatch —
            restricted to{" "}
            <span className="font-medium text-foreground">admin@lyncr.app</span>.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="border-border text-foreground">
          <Link href="/admin">← Admin home</Link>
        </Button>
      </div>

      {lastAction ? (
        <p className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {lastAction}
        </p>
      ) : null}

      {seedWarnings.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-medium text-warning">Seed notes</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-warning/90">
            {seedWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="rounded-xl border border-border/80 bg-card/40 p-6">
        <h2 className="text-base font-semibold text-foreground">End-to-end test flow</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Follow these steps to exercise quiz → routing pool → HUD → SMS intake without manual signup.
        </p>
        <ol className="mt-4 space-y-3 text-sm text-foreground">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-operator/30 text-xs font-semibold text-operator">
              1
            </span>
            <span>
              Click <strong className="font-medium text-foreground">Seed sandbox data</strong> — creates Test Locksmith
              Co. and provisions{" "}
              <span className="font-mono text-operator">test_receptionist@lyncr.app</span> with empty skills (quiz-first).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-operator/30 text-xs font-semibold text-operator">
              2
            </span>
            <span>
              Use <strong className="font-medium text-foreground">Quick-Switch</strong> below — opens the{" "}
              <code className="text-operator">automotive_core</code> quiz as the test receptionist.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-operator/30 text-xs font-semibold text-operator">
              3
            </span>
            <span>
              Pass the quiz to earn the automotive badge, then click{" "}
              <strong className="font-medium text-foreground">Return to Admin Sandbox</strong> in the violet bar at the
              top of the receptionist portal.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-operator/30 text-xs font-semibold text-operator">
              4
            </span>
            <span>
              Fire <strong className="font-medium text-foreground">Simulate inbound call</strong> — the HUD should ring
              for the certified receptionist. Review intake rows in the table below.
            </span>
          </li>
        </ol>

        <div className="mt-5 rounded-xl border border-operator/40 bg-gradient-to-r from-operator/80 via-operator/40 to-card/60 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-operator">
              <KeyRound className="h-4 w-4 shrink-0 text-operator" aria-hidden />
              Quick-Switch to Test Receptionist Session
            </p>
            <p className="mt-1 text-xs leading-relaxed text-operator/80">
              Impersonates <span className="font-mono">test_receptionist@lyncr.app</span> and jumps straight to the
              automotive_core training quiz. Auto-seeds if the account is missing.
            </p>
          </div>
          <Button
            type="button"
            className="mt-3 w-full shrink-0 bg-operator hover:bg-operator sm:mt-0 sm:w-auto"
            disabled={quickSwitchBusy}
            onClick={() => void handleQuickSwitch()}
          >
            {quickSwitchBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            )}
            Quick-Switch to Test Receptionist Session
          </Button>
        </div>
        {quickSwitchError ? (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {quickSwitchError}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-operator/30 bg-card/60">
          <CardHeader className="pb-3">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-operator/20 text-operator">
              <Database className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg text-foreground">Run DB Environment Seed</CardTitle>
            <CardDescription className="text-muted-foreground">
              Creates <strong className="font-medium text-foreground">Test Locksmith Co.</strong> with SMS dispatch
              enabled, automotive routing line, and <code className="text-operator">automotive_core</code> quiz in
              Neon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              className="w-full bg-operator hover:bg-operator"
              disabled={pending}
              onClick={handleSeed}
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              Seed sandbox data
            </Button>
          </CardContent>
        </Card>

        <Card className="border-warning/30 bg-card/60">
          <CardHeader className="pb-3">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-warning/20 text-warning">
              <PhoneIncoming className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg text-foreground">Fire Simulated Inbound Call</CardTitle>
            <CardDescription className="text-muted-foreground">
              Writes in-progress <code className="text-warning">call_logs</code> for every online receptionist matched
              to the sandbox line — opens the live HUD on{" "}
              <Link href="/receptionist" className="text-warning underline-offset-2 hover:underline">
                /receptionist
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              className="w-full border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
              disabled={pending || !environment?.business_line_id}
              onClick={handleMockCall}
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PhoneIncoming className="mr-2 h-4 w-4" />}
              Simulate inbound call
            </Button>
          </CardContent>
        </Card>

        <Card className="border-info/30 bg-card/60 md:col-span-2 lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-info/20 text-info">
              <ScrollText className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg text-foreground">Workspace snapshot</CardTitle>
            <CardDescription className="text-muted-foreground">Current sandbox profile after seed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            {environment ? (
              <>
                <Row label="Business" value={environment.business_name} />
                <Row label="Line" value={environment.business_line_e164 ?? "—"} mono />
                <Row label="Line ID" value={environment.business_line_id ?? "—"} mono />
                <Row label="SMS leads" value={environment.sms_leads_enabled ? "Enabled" : "Off"} />
                <Row label="Latest SMS" value={environment.sms_latest_enabled ? "Enabled" : "Off"} />
                <Row label="Dispatch SMS" value={environment.dispatch_sms_phone ?? "—"} mono />
                <Row label="Quiz module" value={environment.certification_code} mono />
                <Row
                  label="Test receptionist"
                  value={environment.test_receptionist_email}
                  mono
                />
                <Row
                  label="Receptionist user ID"
                  value={environment.test_receptionist_user_id ?? "Not provisioned — re-seed"}
                  mono
                />
              </>
            ) : (
              <p className="text-muted-foreground">Not seeded yet — run DB Environment Seed.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Review logs &amp; dispatches</h2>
            <p className="text-sm text-muted-foreground">
              Latest <code className="text-muted-foreground">ai_leads.collected</code> intake payloads for the sandbox
              workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-success/40 text-success"
              disabled={pending}
              onClick={handleRepairSms}
            >
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Repair SMS
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={pending}
              onClick={refreshLogs}
            >
              <RefreshCw className={cn("mr-1 h-4 w-4", pending && "animate-spin")} />
              Refresh table
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/80 bg-card/50">
          {intakeLogs.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              No intake records yet. Seed the sandbox — a sample AKL lead is inserted automatically.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border/80 text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Caller</th>
                    <th className="px-4 py-3 font-medium">Intent</th>
                    <th className="px-4 py-3 font-medium">intake_payload</th>
                    <th className="px-4 py-3 font-medium">SMS</th>
                  </tr>
                </thead>
                <tbody>
                  {intakeLogs.map((row) => (
                    <tr key={row.id} className="border-b border-border/80 last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatWhen(row.created_at)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{row.caller_e164 ?? "—"}</td>
                      <td className="px-4 py-3 text-foreground">{row.intent_slug ?? "—"}</td>
                      <td className="max-w-md px-4 py-3">
                        <pre className="max-h-32 overflow-auto rounded-md bg-background/80 p-2 font-mono text-2xs leading-relaxed text-success/90">
                          {JSON.stringify(row.intake_payload, null, 2)}
                        </pre>
                        {row.summary ? (
                          <p className="mt-1 text-xs text-muted-foreground">{row.summary}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {row.sms_sent ? (
                          row.sms_error ? (
                            <Badge variant="outline" className="border-warning/40 text-warning">
                              Queued — {row.sms_error}
                            </Badge>
                          ) : (
                            <Badge className="border-0 bg-success/20 text-success">Queued</Badge>
                          )
                        ) : row.sms_error ? (
                          <Badge variant="outline" className="border-warning/40 text-warning">
                            {row.sms_error}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Test receptionist login:{" "}
        <span className="font-mono text-muted-foreground">test_receptionist@lyncr.app</span>
        {" · "}
        Sandbox owner: <span className="font-mono text-muted-foreground">sandbox-test-locksmith@lyncr.app</span>
        {" · "}
        Dev password (both): <span className="font-mono text-muted-foreground">SandboxDev123!</span>
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Live SMS tests: add{" "}
        <span className="font-mono text-muted-foreground">SANDBOX_SMS_DISPATCH_E164</span> in Vercel (your real cell,
        E.164). Outbound sender uses your Telnyx line{" "}
        <span className="font-mono text-muted-foreground">+15025758166</span>. If the table shows{" "}
        <strong className="font-medium text-muted-foreground">Queued</strong> but no text arrives, register{" "}
        <strong className="font-medium text-muted-foreground">10DLC</strong> in Telnyx Mission Control → Messaging → 10DLC
        and assign your line to an approved campaign.
      </p>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className={cn("text-right text-foreground", mono && "font-mono text-2xs")}>{value}</span>
    </div>
  )
}
