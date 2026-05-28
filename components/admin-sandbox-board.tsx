"use client"

// Internal dev sandbox board — seed DB, simulate calls, inspect intake dispatches.

import { useCallback, useState, useTransition } from "react"
import Link from "next/link"
import {
  Database,
  Loader2,
  PhoneIncoming,
  RefreshCw,
  ScrollText,
  Shield,
  Zap,
} from "lucide-react"
import { toast } from "sonner"
import {
  fetchSandboxIntakeLogs,
  runSeedSandboxData,
  runTriggerMockCall,
  type SandboxEnvironment,
  type SandboxIntakeLogRow,
} from "@/app/actions/sandbox-engine"
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
  const [lastAction, setLastAction] = useState<string | null>(null)

  const refreshLogs = useCallback(() => {
    startTransition(async () => {
      const rows = await fetchSandboxIntakeLogs(30)
      setIntakeLogs(rows)
    })
  }, [])

  function handleSeed() {
    startTransition(async () => {
      try {
        const result = await runSeedSandboxData()
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        setEnvironment(result.environment)
        setLastAction(result.message)
        if (result.warnings.length > 0) {
          toast.warning("Sandbox seeded with migration warnings — see banner on this page.")
        } else {
          toast.success("Sandbox environment seeded")
        }
        refreshLogs()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sandbox seed failed unexpectedly")
      }
    })
  }

  function handleMockCall() {
    const lineId = environment?.business_line_id
    if (!lineId) {
      toast.error("Run DB Environment Seed first — no business line id yet.")
      return
    }
    startTransition(async () => {
      const result = await runTriggerMockCall(lineId)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setLastAction(result.message)
      toast.success(`HUD updated for ${result.notified_receptionists.length} receptionist(s)`)
    })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-200">
              <Shield className="mr-1 h-3 w-3" aria-hidden />
              Dev only
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Developer sandbox</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            End-to-end testing for call routing, receptionist HUD, automotive_core quiz, and SMS intake dispatch —
            restricted to{" "}
            <span className="font-medium text-slate-300">admin@lyncr.app</span>.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="border-slate-600 text-slate-300">
          <Link href="/admin">← Admin home</Link>
        </Button>
      </div>

      {lastAction ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {lastAction}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-violet-500/30 bg-slate-900/60">
          <CardHeader className="pb-3">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600/20 text-violet-300">
              <Database className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg text-slate-100">Run DB Environment Seed</CardTitle>
            <CardDescription className="text-slate-400">
              Creates <strong className="font-medium text-slate-300">Test Locksmith Co.</strong> with SMS dispatch
              enabled, automotive routing line, and <code className="text-violet-300">automotive_core</code> quiz in
              Neon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              className="w-full bg-violet-600 hover:bg-violet-500"
              disabled={pending}
              onClick={handleSeed}
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              Seed sandbox data
            </Button>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30 bg-slate-900/60">
          <CardHeader className="pb-3">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
              <PhoneIncoming className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg text-slate-100">Fire Simulated Inbound Call</CardTitle>
            <CardDescription className="text-slate-400">
              Writes in-progress <code className="text-amber-200">call_logs</code> for every online receptionist matched
              to the sandbox line — opens the live HUD on{" "}
              <Link href="/receptionist" className="text-amber-200 underline-offset-2 hover:underline">
                /receptionist
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              className="w-full border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
              disabled={pending || !environment?.business_line_id}
              onClick={handleMockCall}
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PhoneIncoming className="mr-2 h-4 w-4" />}
              Simulate inbound call
            </Button>
          </CardContent>
        </Card>

        <Card className="border-sky-500/30 bg-slate-900/60 md:col-span-2 lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
              <ScrollText className="h-5 w-5" aria-hidden />
            </div>
            <CardTitle className="text-lg text-slate-100">Workspace snapshot</CardTitle>
            <CardDescription className="text-slate-400">Current sandbox profile after seed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-slate-400">
            {environment ? (
              <>
                <Row label="Business" value={environment.business_name} />
                <Row label="Line" value={environment.business_line_e164 ?? "—"} mono />
                <Row label="Line ID" value={environment.business_line_id ?? "—"} mono />
                <Row label="SMS leads" value={environment.sms_leads_enabled ? "Enabled" : "Off"} />
                <Row label="Dispatch SMS" value={environment.dispatch_sms_phone ?? "—"} mono />
                <Row label="Quiz module" value={environment.certification_code} mono />
              </>
            ) : (
              <p className="text-slate-500">Not seeded yet — run DB Environment Seed.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Review logs &amp; dispatches</h2>
            <p className="text-sm text-slate-500">
              Latest <code className="text-slate-400">ai_leads.collected</code> intake payloads for the sandbox
              workspace.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-slate-400"
            disabled={pending}
            onClick={refreshLogs}
          >
            <RefreshCw className={cn("mr-1 h-4 w-4", pending && "animate-spin")} />
            Refresh table
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/50">
          {intakeLogs.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              No intake records yet. Seed the sandbox — a sample AKL lead is inserted automatically.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-700/80 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Caller</th>
                    <th className="px-4 py-3 font-medium">Intent</th>
                    <th className="px-4 py-3 font-medium">intake_payload</th>
                    <th className="px-4 py-3 font-medium">SMS</th>
                  </tr>
                </thead>
                <tbody>
                  {intakeLogs.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800/80 last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">{formatWhen(row.created_at)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{row.caller_e164 ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-300">{row.intent_slug ?? "—"}</td>
                      <td className="max-w-md px-4 py-3">
                        <pre className="max-h-32 overflow-auto rounded-md bg-slate-950/80 p-2 font-mono text-[11px] leading-relaxed text-emerald-100/90">
                          {JSON.stringify(row.intake_payload, null, 2)}
                        </pre>
                        {row.summary ? (
                          <p className="mt-1 text-xs text-slate-500">{row.summary}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {row.sms_sent ? (
                          <Badge className="border-0 bg-emerald-500/20 text-emerald-200">Sent</Badge>
                        ) : row.sms_error ? (
                          <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                            {row.sms_error}
                          </Badge>
                        ) : (
                          <span className="text-slate-500">—</span>
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

      <p className="text-xs text-slate-600">
        Training quiz:{" "}
        <Link href="/receptionist/training/automotive_core" className="text-violet-400 hover:underline">
          /receptionist/training/automotive_core
        </Link>
        {" · "}
        Sandbox owner login: <span className="font-mono text-slate-500">sandbox-test-locksmith@lyncr.app</span>
      </p>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className={cn("text-right text-slate-300", mono && "font-mono text-[11px]")}>{value}</span>
    </div>
  )
}
