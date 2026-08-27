"use client"

// Receptionist workspace — Home (console), Calls (ledger + intake), Earnings (pay metrics).
// Home is a live ops desk: duty band + answer channel + live strip (not a stack of marketing cards).

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Loader2, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReceptionistLedgerRow, ReceptionistPortalDashboard } from "@/lib/types"
import Link from "next/link"
import { resolveBrowserTimezone } from "@/lib/telemetry-timezone"
import { getPusherClient, isRealtimeClientConfigured } from "@/lib/realtime/pusher-client"
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

/**
 * Compact live strip under the duty band — shows the in-progress caller detail the duty
 * band's headline has no room for. Idle/off-duty states already say everything this strip
 * would otherwise repeat (status + business name), so it renders nothing then rather than
 * echoing the hero band.
 */
function LiveStatusStrip({ dashboard }: { dashboard: ReceptionistPortalDashboard }) {
  const { live_status } = dashboard
  const onCall = live_status.mode === "on_call"
  const ringing = live_status.mode === "ringing"
  if (!onCall && !ringing) return null

  const headline = ringing ? "Incoming call — ringing" : "On an active call"
  const detail = (
    <>
      {ringing ? "Ringing for " : "Answering for "}
      <span className="font-medium text-zinc-200">{live_status.business_name}</span>
      {" · "}
      {formatPhoneDisplay(live_status.caller_number)}
      {live_status.caller_name ? ` (${live_status.caller_name})` : ""}
    </>
  )

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors duration-300",
        onCall ? "border-emerald-500/35 bg-emerald-950/25" : "border-primary/25 bg-primary/5"
      )}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
        <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", onCall ? "bg-emerald-400" : "bg-primary")} />
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

/** True when the call landed on the operator's own calendar day, not UTC's. */
function isSameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/** Shift totals — what she has done today, not what the business has billed all period. */
function TodayBand({ dashboard }: { dashboard: ReceptionistPortalDashboard }) {
  const now = new Date()
  const rows = dashboard.recent_calls ?? []
  const today = rows.filter((row) => isSameLocalDay(row.created_at, now))
  const answered = today.filter((row) => row.duration_seconds > 0).length
  const talkSeconds = today.reduce((sum, row) => sum + (row.duration_seconds || 0), 0)

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <WorkspaceStatCard
        dense
        label="Calls today"
        value={String(today.length)}
        hint={answered === today.length ? "All answered" : `${answered} answered`}
      />
      <WorkspaceStatCard
        dense
        label="Earned today"
        value={formatUsd(dashboard.metrics.today_earnings)}
        hint="Since midnight, your time"
        accent="primary"
      />
      <WorkspaceStatCard dense label="Talk time" value={formatDuration(talkSeconds)} hint="Across today's calls" />
    </div>
  )
}

/**
 * The people who called, with what CRM knows about them and a way to reach them back.
 *
 * This is the working surface of the console. It matters most on a CELL setup, where the
 * browser screen-pop never opens and this is the only place the caller's identity appears.
 */
function RecentCallerList({
  rows,
  businessName,
}: {
  rows: ReceptionistLedgerRow[]
  businessName: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const recent = rows.slice(0, 6)

  if (recent.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-zinc-500">
        No calls yet. When one is routed to you it lands here, with whatever the business
        already knows about the caller.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border/40">
      {recent.map((row) => {
        const dialable = row.from_number.replace(/[^\d+]/g, "")
        const open = openId === row.id
        return (
          <li key={row.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {row.caller_name?.trim() || formatPhoneDisplay(row.from_number)}
                </p>
                <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
                  {row.caller_name?.trim() ? `${formatPhoneDisplay(row.from_number)} · ` : ""}
                  {formatTimestamp(row.created_at)} · {formatDuration(row.duration_seconds)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <a
                  href={`tel:${dialable}`}
                  className="rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  Call back
                </a>
                <a
                  href={`sms:${dialable}`}
                  className="rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-muted/30"
                >
                  Text
                </a>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : row.id)}
                  className="rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-muted/30"
                >
                  {open ? "Close" : "Notes"}
                </button>
              </div>
            </div>
            {open ? (
              <div className="mt-3">
                <ReceptionistSimpleIntake
                  callLogId={row.id}
                  callerNumber={row.from_number}
                  initialCallerName={row.caller_name}
                  businessName={businessName}
                  onSaved={() => setOpenId(null)}
                  onCancel={() => setOpenId(null)}
                />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
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
      {/* No <table> here — WorkspaceTableWrap renders it. Nesting one trips hydration. */}
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
    </WorkspaceTableWrap>
  )
}

/** Realtime is live — poll only as a safety net against a dropped event. */
const DASHBOARD_POLL_MS_REALTIME = 12_000
/** No realtime — polling is the only way the HUD ever opens, so it runs hard. */
const DASHBOARD_POLL_MS_FALLBACK = 3_000

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

  // Poll hard when realtime is off and lazily when it is on, matching what the owner
  // console (CallAnsweredModal) has always done. A fixed 15s here was the reason the
  // portal went silent on a deploy with no Pusher keys while the owner console kept
  // working from the same data.
  useEffect(() => {
    load()
    const intervalMs = isRealtimeClientConfigured()
      ? DASHBOARD_POLL_MS_REALTIME
      : DASHBOARD_POLL_MS_FALLBACK
    const timer = window.setInterval(() => {
      // A backgrounded tab does not need a live call HUD, and a phone that slept for
      // an hour should not wake to a queue of stale polls.
      if (document.visibilityState !== "visible") return
      load({ silent: true })
    }, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === "visible") load({ silent: true })
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load])

  // Calls whose intake has already been opened once, by either path. Without this a
  // receptionist who dismisses the HUD mid-call gets it thrown back at her by the very
  // next poll, and there is no way to close it until the caller hangs up.
  const [handledCallSid, setHandledCallSid] = useState<string | null>(null)

  // Open intake from polled state when realtime did not, or could not, deliver.
  //
  // Adjusted during render rather than in an effect: an effect would paint an empty
  // HUD first and fill it on the next pass. Deliberately one-way — this opens the
  // HUD, never closes it. A call ending is exactly when a receptionist is still
  // typing up what it was about, and a poll landing after hangup must not take the
  // form away mid-sentence. Closing stays with the explicit dismiss and call-ended.
  const polledLive =
    dashboard?.live_status.mode === "on_call" || dashboard?.live_status.mode === "ringing"
      ? dashboard.live_status
      : null
  // Same id realtime publishes, so a call opened by one path and closed by the other
  // logs its intake against the same call.
  const polledCallSid = polledLive?.provider_call_sid ?? null
  const polledAnswered = dashboard?.live_status.mode === "on_call"

  if (polledLive && polledCallSid && polledCallSid !== handledCallSid && !activeCall) {
    setHandledCallSid(polledCallSid)
    setActiveCall({
      callLogId: polledCallSid,
      businessType: polledLive.business_type,
      callerNumber: polledLive.caller_number,
      callerName: polledLive.caller_name,
      businessName: polledLive.business_name,
      startedAt: polledLive.started_at ?? new Date().toISOString(),
      // Ringing until proven otherwise — the clock in the HUD depends on it.
      answeredAt: polledAnswered ? (polledLive.started_at ?? new Date().toISOString()) : null,
    })
  } else if (
    polledLive &&
    polledAnswered &&
    activeCall &&
    activeCall.callLogId === polledCallSid &&
    !activeCall.answeredAt
  ) {
    // Ringing → answered on a HUD that is already open. Stamp the pickup so the timer
    // switches from counting ring time to counting talk time.
    setActiveCall({ ...activeCall, answeredAt: polledLive.started_at ?? new Date().toISOString() })
  } else if (dashboard && !polledLive && activeCall && !activeCall.answeredAt) {
    // The caller hung up before anyone picked up. There is nothing to write up about a
    // call that never happened, so the HUD closes itself rather than sitting there with
    // a running clock. An ANSWERED call that ends is left alone on purpose — that is
    // exactly when she is still typing up what it was about.
    setActiveCall(null)
  }

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
      setHandledCallSid(payload.callLogId)
      setActiveCall({
        answeredAt: payload.answeredAt ?? payload.startedAt ?? new Date().toISOString(),
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
  // From the live plan. The legacy pay_mode / flat_rate_usd columns are no longer
  // written when an owner changes pay, so deriving the label from them showed the
  // old rate indefinitely.
  const rateLabel =
    dashboard.pay_summary ||
    (dashboard.receptionist.pay_mode === "FLAT_RATE"
      ? `${formatUsd(dashboard.receptionist.flat_rate_usd)} / call`
      : `${formatUsd(dashboard.receptionist.rate_per_minute)} / min`)

  const available = dashboard.receptionist.is_active
  const onCall = dashboard.live_status.mode === "on_call"
  const ringingNow = dashboard.live_status.mode === "ringing"

  return (
    <WorkspacePage className={tab === "home" ? "gap-3 sm:gap-4" : undefined}>
      {/* Calls / Earnings keep the default page rhythm and a compact page header; Home is
          a live ops desk, not a stack of cards, and permanently runs tighter — this is not
          a leftover from the console redesign, it uses the duty band as the hero instead. */}
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
                  {onCall ? "ON CALL" : ringingNow ? "RINGING" : available ? "ON DUTY" : "OFF DUTY"}
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

          {/* What this shift has actually done — the console used to show nothing here. */}
          <TodayBand dashboard={dashboard} />

          {/* Who called, who they are, and how to reach them back. On a CELL setup this is
              the only place the caller's identity appears — the browser screen-pop never
              opens, so putting it behind that card would have hidden it entirely. */}
          <WorkspacePanel className="overflow-hidden shadow-none ring-0">
            <div className="flex items-baseline justify-between gap-3 border-b border-border/50 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Recent callers</h2>
              <Link href="/receptionist/calls" className="text-xs font-medium text-primary hover:underline">
                See all
              </Link>
            </div>
            <RecentCallerList rows={callRows} businessName={dashboard.business_name} />
          </WorkspacePanel>
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
