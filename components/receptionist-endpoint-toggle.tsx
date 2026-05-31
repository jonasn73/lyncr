"use client"

// Receptionist HUD control: choose where live calls land — the browser (WEB, Telnyx WebRTC)
// or the cell phone (CELL, PSTN forward). Persists via PATCH /api/receptionist/endpoint and
// shows the live registration status of the browser calling engine.

import { useState } from "react"
import { Loader2, MonitorSmartphone, Smartphone } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkspacePanel } from "@/components/dashboard-workspace-ui"
import type { WebRtcStatus } from "@/lib/webrtc/use-telnyx-webrtc"

type Endpoint = "WEB" | "CELL"

interface EndpointToggleProps {
  endpoint: Endpoint
  /** True once a sip_username is provisioned, so WEB can actually carry audio. */
  webCallingAvailable: boolean
  /** Live status from the WebRTC engine (only meaningful while endpoint = WEB). */
  webStatus: WebRtcStatus
  webError: string | null
  /** Called after the new endpoint is saved, so the parent can start/stop the engine. */
  onChange: (next: Endpoint) => void
}

// Human-readable label + dot color for each WebRTC engine state.
function webStatusLabel(status: WebRtcStatus): { text: string; dot: string } {
  switch (status) {
    case "connecting":
      return { text: "Connecting your browser…", dot: "bg-amber-400" }
    case "registered":
      return { text: "Browser ready for calls", dot: "bg-emerald-400" }
    case "ringing":
      return { text: "Incoming call ringing your browser", dot: "bg-emerald-400 animate-pulse" }
    case "active":
      return { text: "On a browser call", dot: "bg-emerald-400" }
    case "not_provisioned":
      return { text: "Browser calling not set up yet — using your cell", dot: "bg-zinc-500" }
    case "error":
      return { text: "Browser calling error — using your cell", dot: "bg-red-400" }
    default:
      return { text: "", dot: "bg-zinc-600" }
  }
}

export function ReceptionistEndpointToggle({
  endpoint,
  webCallingAvailable,
  webStatus,
  webError,
  onChange,
}: EndpointToggleProps) {
  // Optimistic local copy so the buttons feel instant while the PATCH is in flight.
  const [current, setCurrent] = useState<Endpoint>(endpoint)
  const [saving, setSaving] = useState<Endpoint | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const status = webStatusLabel(webStatus)
  const showWebStatus = current === "WEB" && status.text

  return (
    <WorkspacePanel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Answer calls on</p>
          <p className="mt-1 text-sm text-zinc-400">
            Pick where calls routed to you ring. Browser is instant; cell forwards to your phone.
          </p>
        </div>

        {/* Segmented control: Cell vs Browser */}
        <div
          role="radiogroup"
          aria-label="Call answering endpoint"
          className="inline-flex rounded-lg border border-border/60 bg-zinc-900/40 p-1"
        >
          <EndpointButton
            active={current === "CELL"}
            busy={saving === "CELL"}
            onClick={() => select("CELL")}
            icon={<Smartphone className="h-4 w-4" aria-hidden />}
            label="Cell phone"
          />
          <EndpointButton
            active={current === "WEB"}
            busy={saving === "WEB"}
            onClick={() => select("WEB")}
            icon={<MonitorSmartphone className="h-4 w-4" aria-hidden />}
            label="Web browser"
          />
        </div>
      </div>

      {/* Live engine status (only while WEB is selected). */}
      {showWebStatus ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
          <span className={cn("inline-block h-2 w-2 rounded-full", status.dot)} aria-hidden />
          <span>{status.text}</span>
          {webStatus === "error" && webError ? <span className="text-red-400">· {webError}</span> : null}
        </div>
      ) : null}

      {/* Hint when WEB is chosen but not yet provisioned. */}
      {current === "WEB" && !webCallingAvailable ? (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          Browser calling isn’t fully set up for your account yet, so calls will still ring your cell phone
          until an admin finishes provisioning your SIP endpoint.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </WorkspacePanel>
  )
}

function EndpointButton({
  active,
  busy,
  onClick,
  icon,
  label,
}: {
  active: boolean
  busy: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:text-zinc-200",
        busy && "opacity-70"
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  )
}
