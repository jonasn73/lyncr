"use client"

// Receptionist HUD control: choose where live calls land — the browser (WEB, Telnyx WebRTC)
// or the cell phone (CELL, PSTN forward). Persists via PATCH /api/receptionist/endpoint and
// shows the live registration status of the browser calling engine.
//
// variant="console" — compact segmented control (Home console)
// variant="card" — older bordered instructional panel

import { useEffect, useState } from "react"
import { Loader2, MonitorSmartphone, Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import type { WebRtcStatus } from "@/lib/webrtc/use-telnyx-webrtc"

type Endpoint = "WEB" | "CELL"

interface EndpointToggleProps {
  endpoint: Endpoint
  /** True once a sip_username is provisioned, so WEB can actually carry audio. */
  webCallingAvailable: boolean
  /**
   * True when inbound actually dials the browser.
   * False on Call Control production until SIP dial ships — show honesty banner.
   */
  browserInboundLive?: boolean
  /** Live status from the WebRTC engine (only meaningful while endpoint = WEB). */
  webStatus: WebRtcStatus
  webError: string | null
  /** Called after the new endpoint is saved, so the parent can start/stop the engine. */
  onChange: (next: Endpoint) => void
  /** "console" = denser control row; "card" = legacy panel */
  variant?: "card" | "console"
}

// Human-readable label + dot color for each WebRTC engine state.
function webStatusLabel(
  status: WebRtcStatus,
  browserInboundLive: boolean
): { text: string; dot: string } {
  switch (status) {
    case "connecting":
      return { text: "Connecting your browser…", dot: "bg-warning" }
    case "registered":
      return browserInboundLive
        ? { text: "Browser ready for calls", dot: "bg-success" }
        : { text: "Browser registered — inbound still rings Cell", dot: "bg-warning" }
    case "ringing":
      return { text: "Incoming call ringing your browser", dot: "bg-success animate-pulse" }
    case "active":
      return { text: "On a browser call", dot: "bg-success" }
    case "reconnecting":
      return { text: "Reconnecting your browser…", dot: "bg-warning animate-pulse" }
    case "not_provisioned":
      return { text: "Browser calling not set up yet — using your cell", dot: "bg-zinc-500" }
    case "error":
      return { text: "Browser calling error — using your cell", dot: "bg-destructive" }
    default:
      return { text: "", dot: "bg-zinc-600" }
  }
}

export function ReceptionistEndpointToggle({
  endpoint,
  webCallingAvailable,
  browserInboundLive = false,
  webStatus,
  webError,
  onChange,
  variant = "console",
}: EndpointToggleProps) {
  // Optimistic local copy so the buttons feel instant while the PATCH is in flight.
  const [current, setCurrent] = useState<Endpoint>(endpoint)
  const [saving, setSaving] = useState<Endpoint | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep local segment in sync when the parent reloads from the server
  useEffect(() => {
    if (!saving) setCurrent(endpoint)
  }, [endpoint, saving])

  async function select(next: Endpoint) {
    if (next === current || saving) return
    setSaving(next)
    setError(null)
    const previous = current
    setCurrent(next) // optimistic
    try {
      const res = await fetch("/api/receptionist/endpoint", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: next }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not update endpoint")
      onChange(next)
    } catch (e) {
      setCurrent(previous) // revert on failure
      setError(e instanceof Error ? e.message : "Could not update endpoint")
    } finally {
      setSaving(null)
    }
  }

  const status = webStatusLabel(webStatus, browserInboundLive)
  const showWebStatus = current === "WEB" && status.text
  const showBrowserNotLive =
    current === "WEB" && (!webCallingAvailable || !browserInboundLive)

  // Shared Cell / Browser segmented control
  const segment = (
    <div
      role="radiogroup"
      aria-label="Call answering endpoint"
      className="inline-flex w-full rounded-lg border border-border/50 bg-background/50 p-0.5 sm:w-auto"
    >
      <EndpointButton
        active={current === "CELL"}
        busy={saving === "CELL"}
        onClick={() => select("CELL")}
        icon={<Smartphone className="h-3.5 w-3.5" aria-hidden />}
        label="Cell"
        className="flex-1 sm:flex-none"
      />
      <EndpointButton
        active={current === "WEB"}
        busy={saving === "WEB"}
        onClick={() => select("WEB")}
        icon={<MonitorSmartphone className="h-3.5 w-3.5" aria-hidden />}
        label="Browser"
        className="flex-1 sm:flex-none"
      />
    </div>
  )

  // Extra status / warnings shared by both variants
  const extras = (
    <>
      {showWebStatus ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full", status.dot)} aria-hidden />
          <span>{status.text}</span>
          {webStatus === "error" && webError ? <span className="text-destructive">· {webError}</span> : null}
        </div>
      ) : null}

      {showBrowserNotLive ? (
        <p className="rounded-md border border-warning/25 bg-warning/20 px-3 py-2 text-xs text-warning">
          Browser ringing not live yet — use Cell. Inbound Call Control still dials your phone.
        </p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </>
  )

  // Console: tight row under the duty band (no big instructional card)
  if (variant === "console") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Answer on
          </p>
          {/* Longer hint only on desktop — mobile stays action-first */}
          <p className="hidden text-xs text-muted-foreground md:block">
            Where rings land when you&apos;re selected
          </p>
        </div>
        {segment}
        {extras}
      </div>
    )
  }

  // Legacy card layout
  return (
    <WorkspacePanel density="default">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Answer calls on</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick where calls routed to you ring. Browser is instant; cell forwards to your phone.
          </p>
        </div>
        {segment}
      </div>
      <div className="mt-4 space-y-2">{extras}</div>
    </WorkspacePanel>
  )
}

function EndpointButton({
  active,
  busy,
  onClick,
  icon,
  label,
  className,
}: {
  active: boolean
  busy: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
        active ? "bg-primary text-primary-foreground shadow-resting" : "text-muted-foreground hover:text-foreground",
        busy && "opacity-70",
        className
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  )
}
