"use client"

// Receptionist workspace — Home (console), Calls (ledger + intake), Earnings (pay metrics).
// Home is a live ops desk: duty band + answer channel + live strip (not a stack of marketing cards).

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Loader2, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReceptionistLedgerRow, ReceptionistPortalDashboard } from "@/lib/types"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"
import { getPusherClient } from "@/lib/realtime/pusher-client"
import { ReceptionistLiveIntake, type LiveCallSession } from "@/components/receptionist-live-intake"
import { ReceptionistEndpointToggle } from "@/components/receptionist-endpoint-toggle"
import { ReceptionistAvailabilityToggle } from "@/components/receptionist-availability-toggle"
import { ReceptionistSimpleIntake } from "@/components/receptionist-simple-intake"
import { CompanyBriefingCard } from "@/components/receptionist-company-briefing"
import { useTelnyxWebRtc, WEBRTC_REMOTE_AUDIO_ID } from "@/lib/webrtc/use-telnyx-webrtc"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  WorkspaceStatCard,
  WorkspaceTableWrap,
  WorkspaceTh,
  WorkspaceTd,
  WORKSPACE_TABLE_ROW_CLASS,
} from "@/components/dashboard-workspace-ui"

type PortalTab = "home" | "calls" | "earnings"

function tabFromPath(pathname: string): PortalTab {
  if (pathname.startsWith("/receptionist/calls")) return "calls"
  if (pathname.startsWith("/receptionist/earnings")) return "earnings"
  return "home"
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith("1"))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return phone
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, "0")}s`
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function billingCycleLabel(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "Current period"
  return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
}

/** Compact live strip under the duty band — not a third full card. */
function LiveStatusStrip({ dashboard }: { dashboard: ReceptionistPortalDashboard }) {
  const { live_status, receptionist } = dashboard
  const onCall = live_status.mode === "on_call"
  const available = receptionist.is_active

  // Primary line shown in the strip
  const headline = onCall
    ? "On an active call"
    : available
      ? "Online & ready"
      : "Off duty"

  // Secondary context (company / caller)
  const detail = onCall ? (
    <>
      Answering for <span className="font-medium text-zinc-200">{live_status.business_name}</span>
      {" · "}
      {formatPhoneDisplay(live_status.caller_number)}
      {live_status.caller_name ? ` (${live_status.caller_name})` : ""}
    </>
  ) : available ? (
    <>
      Waiting for <span className="font-medium text-zinc-200">{live_status.business_name}</span>
    </>
  ) : (
    <>
      Not selected · <span className="font-medium text-zinc-200">{live_status.business_name}</span>
    </>
  )

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors duration-300",
        onCall
          ? "border-emerald-500/35 bg-emerald-950/25"
          : available
            ? "border-primary/25 bg-primary/5"
            : "border-border/40 bg-zinc-950/40"
      )}
    >
      {/* Soft pulse when available and idle — signals “listening” without noise */}
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
        {available && !onCall ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-60" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full",
            onCall ? "bg-emerald-400" : available ? "bg-primary" : "bg-zinc-600"
          )}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {headline}
          <span className="text-zinc-500"> · </span>
          <span className="font-normal text-zinc-400">{detail}</span>
        </p>
      </div>
    </div>
  )
}

function CallRows({
  rows,
  emptyMessage,
  showIntake,
}: {
  rows: ReceptionistLedgerRow[]
  emptyMessage: string
  showIntake: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-zinc-500">{emptyMessage}</p>
  }

  return (
    <WorkspaceTableWrap>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-zinc-500">
            <WorkspaceTh>When</WorkspaceTh>
            <WorkspaceTh>Caller</WorkspaceTh>
            <WorkspaceTh>Duration</WorkspaceTh>
            <WorkspaceTh>Status</WorkspaceTh>
            {showIntake ? <WorkspaceTh>Notes</WorkspaceTh> : <WorkspaceTh className="text-right">Your payout</WorkspaceTh>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={cn(WORKSPACE_TABLE_ROW_CLASS, "border-b border-border/40 last:border-0 align-top")}>
              <WorkspaceTd className="text-zinc-400">{formatTimestamp(row.created_at)}</WorkspaceTd>
              <WorkspaceTd>
                <div className="font-medium text-foreground">{formatPhoneDisplay(row.from_number)}</div>
                {row.caller_name ? <div className="text-xs text-zinc-500">{row.caller_name}</div> : null}
              </WorkspaceTd>
              <WorkspaceTd>{formatDuration(row.duration_seconds)}</WorkspaceTd>
              <WorkspaceTd className="capitalize text-zinc-400">{row.status.replace(/-/g, " ")}</WorkspaceTd>
              {showIntake ? (
                <WorkspaceTd>
                  {openId === row.id ? (
                    <ReceptionistSimpleIntake
                      callLogId={row.id}
                      callerNumber={row.from_number}
                      initialCallerName={row.caller_name}
                      businessName={row.business_name}
                      onSaved={() => setOpenId(null)}
                      onCancel={() => setOpenId(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenId(row.id)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Add notes
                    </button>
                  )}
                </WorkspaceTd>
              ) : (
                <WorkspaceTd className="text-right font-medium text-foreground">{formatUsd(row.payout_usd)}</WorkspaceTd>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </WorkspaceTableWrap>
  )
}

export function ReceptionistPortalView() {
  const pathname = usePathname() || "/receptionist"
  const tab = tabFromPath(pathname)

  const [dashboard, setDashboard] = useState<ReceptionistPortalDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCall, setActiveCall] = useState<LiveCallSession | null>(null)

  const load = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    fetch(`/api/receptionist/dashboard?timezone=${encodeURIComponent(resolveBrowserTimezone())}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json()) as { error?: string; data?: ReceptionistPortalDashboard }
        if (!res.ok) throw new Error(json.error ?? "Could not load dashboard")
        setDashboard(json.data ?? null)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(() => load({ silent: true }), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const receptionistId = dashboard?.receptionist.id ?? null
  const dashboardRef = useRef<ReceptionistPortalDashboard | null>(null)
  dashboardRef.current = dashboard
  useEffect(() => {
    if (!receptionistId) return
    const pusher = getPusherClient()
    if (!pusher) return
    const channelName = `receptionist-${receptionistId}`
    const channel = pusher.subscribe(channelName)

    const onConnected = (payload: LiveCallSession) => {
      setActiveCall({
        callLogId: payload.callLogId,
        businessType: payload.businessType ?? "generic",
        callerNumber: payload.callerNumber ?? null,
        callerName: payload.callerName ?? null,
        businessName: payload.businessName ?? dashboardRef.current?.business_name ?? null,
        startedAt: payload.startedAt ?? new Date().toISOString(),
      })
      load({ silent: true })
    }
    const onEnded = () => {
      setActiveCall(null)
      load({ silent: true })
    }

    channel.bind("call-connected", onConnected)
    channel.bind("call-ended", onEnded)
    return () => {
      channel.unbind("call-connected", onConnected)
      channel.unbind("call-ended", onEnded)
      pusher.unsubscribe(channelName)
    }
  }, [receptionistId, load])

  // Local answer-channel state (synced from server, drives WebRTC)
  const [endpoint, setEndpoint] = useState<"WEB" | "CELL">("CELL")
  const serverEndpoint = dashboard?.receptionist.routing_endpoint
  useEffect(() => {
    if (serverEndpoint === "WEB" || serverEndpoint === "CELL") setEndpoint(serverEndpoint)
  }, [serverEndpoint])

  const webCallingAvailable = dashboard?.web_calling_available ?? false
  const browserInboundLive = dashboard?.browser_inbound_live ?? false
  const web = useTelnyxWebRtc({ enabled: endpoint === "WEB" && webCallingAvailable })

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        Loading console…
      </div>
    )
  }

  if (error && !dashboard) {
    return (
      <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </p>
    )
  }

  if (!dashboard) return null

  const cycleLabel = billingCycleLabel(dashboard.billing_cycle.start, dashboard.billing_cycle.end)
  const callRows = dashboard.recent_calls?.length ? dashboard.recent_calls : dashboard.ledger
  const rateLabel =
    dashboard.receptionist.pay_mode === "FLAT_RATE"
      ? `${formatUsd(dashboard.receptionist.flat_rate_usd)} / call`
      : `${formatUsd(dashboard.receptionist.rate_per_minute)} / min`

  const available = dashboard.receptionist.is_active
  const onCall = dashboard.live_status.mode === "on_call"

  return (
    <WorkspacePage className={tab === "home" ? "gap-3 sm:gap-4" : undefined}>
      {/* Calls / Earnings keep a compact page header; Home uses the duty band as the hero */}
      {tab !== "home" ? (
        <WorkspacePageHeader
          eyebrow={tab === "calls" ? "Console" : "Pay"}
          title={tab === "calls" ? "Calls" : "Earnings"}
          action={
            tab === "earnings" ? (
              <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <Wallet className="h-3.5 w-3.5" aria-hidden />
                {rateLabel}
              </span>
            ) : (
              <span className="text-xs text-zinc-500">{dashboard.business_name}</span>
            )
          }
        />
      ) : null}

      {/* Live call HUD stays available on every tab so intake isn’t lost when navigating. */}
      <audio id={WEBRTC_REMOTE_AUDIO_ID} autoPlay />

      {endpoint === "WEB" && (web.status === "ringing" || web.status === "active") ? (
        <CompanyBriefingCard
          status={web.status}
          operatorName={dashboard.receptionist.name}
          callerNumber={web.call?.callerNumber ?? null}
          callerName={web.call?.callerName ?? null}
          lookupNumber={web.call?.callerNumber ?? null}
          fallbackBusinessName={dashboard.business_name}
          onAnswer={web.answer}
          onHangup={web.hangup}
        />
      ) : null}

      {activeCall ? (
        <ReceptionistLiveIntake
          session={activeCall}
          callerNameFallback={dashboard.live_status.mode === "on_call" ? dashboard.live_status.caller_name : null}
          onDismiss={() => {
            setActiveCall(null)
            load({ silent: true })
          }}
        />
      ) : null}

      {tab === "home" ? (
        <>
          {/* ── Hero duty band: status + toggle + answer channel ── */}
          <section
            className={cn(
              "overflow-hidden rounded-2xl border transition-colors duration-300",
              onCall
                ? "border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-card/90 to-card/90"
                : available
                  ? "border-primary/35 bg-gradient-to-br from-primary/10 via-card/90 to-card/90"
                  : "border-border/50 bg-card/80"
            )}
          >
            <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5 sm:py-5">
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-[0.16em]",
                    onCall ? "text-emerald-400" : available ? "text-primary" : "text-zinc-500"
                  )}
                >
                  Duty status
                </p>
                <h1
                  className={cn(
                    "mt-1 text-2xl font-semibold tracking-tight sm:text-3xl",
                    onCall ? "text-emerald-200" : available ? "text-foreground" : "text-zinc-400"
                  )}
                >
                  {onCall ? "ON CALL" : available ? "ON DUTY" : "OFF DUTY"}
                </h1>
                <p className="mt-1.5 truncate text-sm text-zinc-300">
                  <span className="font-medium text-foreground">{dashboard.business_name}</span>
                  <span className="text-zinc-600"> · </span>
                  <span className="text-zinc-400">{rateLabel}</span>
                </p>
                <p className="mt-2 hidden max-w-md text-xs leading-relaxed text-zinc-500 md:block">
                  {available
                    ? "You’re eligible when the owner has you under Who answers. This switch doesn’t pick you by itself."
                    : "You won’t get rings — calls use the owner’s backup. Who answers stays the owner’s choice."}
                </p>
              </div>

              <ReceptionistAvailabilityToggle
                isAvailable={dashboard.receptionist.is_active}
                businessName={dashboard.business_name}
                onChange={() => load({ silent: true })}
                variant="console"
              />
            </div>

            <div className="border-t border-border/40 px-4 py-3 sm:px-5">
              <ReceptionistEndpointToggle
                endpoint={endpoint}
                webCallingAvailable={webCallingAvailable}
                browserInboundLive={browserInboundLive}
                webStatus={web.status}
                webError={web.error}
                onChange={(next) => {
                  setEndpoint(next)
                  load({ silent: true })
                }}
                variant="console"
              />
            </div>
          </section>

          {/* Compact live strip (hidden while live intake is open) */}
          {!activeCall ? <LiveStatusStrip dashboard={dashboard} /> : null}

          {/* Desktop tip only — non-actionable on phones */}
          <p className="hidden text-center text-xs text-zinc-600 md:block">
            Calls &amp; earnings are in their own tabs — use the menu above (or bottom bar on phones).
          </p>
        </>
      ) : null}

      {tab === "calls" ? (
        <WorkspacePanel className="overflow-hidden shadow-none ring-0">
          <div className="border-b border-border/50 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Calls that rang your line</h2>
            <p className="mt-0.5 hidden text-xs text-zinc-500 md:block">
              Only calls routed to you for {dashboard.business_name} — not every company call.
            </p>
          </div>
          <CallRows
            rows={callRows}
            emptyMessage="No calls have rung your phone yet. When a customer is routed to you, it shows up here."
            showIntake
          />
        </WorkspacePanel>
      ) : null}

      {tab === "earnings" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
            <WorkspaceStatCard
              label="Today"
              value={formatUsd(dashboard.metrics.today_earnings)}
              hint="Since midnight, your time"
              accent="primary"
            />
            <WorkspaceStatCard
              label="Pay period"
              value={formatUsd(dashboard.metrics.pay_period_earnings)}
              hint={cycleLabel}
              accent="success"
            />
            <WorkspaceStatCard
              label="Talk time"
              value={`${dashboard.metrics.total_active_talk_minutes} min`}
              hint={`${dashboard.metrics.total_active_talk_seconds}s this period`}
            />
          </div>

          <WorkspacePanel className="overflow-hidden shadow-none ring-0">
            <div className="border-b border-border/50 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Pay period ledger</h2>
              <p className="mt-0.5 hidden text-xs text-zinc-500 md:block">
                Answered calls this pay period for {dashboard.business_name}. Payout per row.
              </p>
            </div>
            <CallRows
              rows={dashboard.ledger}
              emptyMessage="No answered calls this pay period yet — nothing to pay out."
              showIntake={false}
            />
          </WorkspacePanel>
        </>
      ) : null}
    </WorkspacePage>
  )
}
