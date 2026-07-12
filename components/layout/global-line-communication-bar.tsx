"use client"

// Cross-tab Dynamic Island — amber while ringing, cyan while connected.

import { memo, useEffect, useState } from "react"
import { Phone, PhoneIncoming } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLyncEngineOptional } from "@/lib/lync-engine-context"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"

export const GlobalLineCommunicationBar = memo(function GlobalLineCommunicationBar() {
  const engine = useLyncEngineOptional()
  const call = engine?.primaryCall ?? null
  const [elapsedSec, setElapsedSec] = useState(0)

  // Tick talk time while connected.
  useEffect(() => {
    if (!call || call.phase !== "connected" || !call.answeredAt) {
      setElapsedSec(0)
      return
    }
    const tick = () => {
      const start = new Date(call.answeredAt!).getTime()
      if (!Number.isFinite(start)) return
      setElapsedSec(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [call])

  if (!engine || !call) return null

  const ringing = call.phase === "ringing"
  const phone = formatPhoneDisplay(call.fromNumber) || call.fromNumber || "Incoming"
  const contextMeta =
    call.callerContext?.kind === "active_job"
      ? call.callerContext.metaLine
      : call.callerContext?.kind === "unknown"
        ? call.callerContext.cnamToken
        : null

  const mm = Math.floor(elapsedSec / 60)
  const ss = String(elapsedSec % 60).padStart(2, "0")

  return (
    <div
      className={cn(
        "sticky top-0 z-[35] w-full border-b px-3 py-2 backdrop-blur-md",
        ringing
          ? "border-amber-500/30 bg-amber-950/80"
          : "border-cyan-500/30 bg-cyan-950/70"
      )}
    >
      <button
        type="button"
        onClick={() => engine.focusIntake()}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left transition-all",
          "active:scale-[0.99] touch-manipulation",
          ringing
            ? "bg-amber-500/10 hover:bg-amber-500/15"
            : "bg-cyan-500/10 hover:bg-cyan-500/15"
        )}
        aria-label={ringing ? "Open ringing call intake" : "Open connected call intake"}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            ringing ? "bg-amber-500/20 text-amber-200" : "bg-cyan-500/20 text-cyan-200"
          )}
        >
          {ringing ? (
            <PhoneIncoming className="h-4 w-4 animate-pulse" aria-hidden />
          ) : (
            <Phone className="h-4 w-4" aria-hidden />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[10px] font-bold uppercase tracking-wider",
              ringing ? "text-amber-300/90" : "text-cyan-300/90"
            )}
          >
            {ringing ? "Incoming · Ringing" : `Live · ${mm}:${ss}`}
          </span>
          <span className="block truncate text-sm font-semibold tabular-nums text-slate-100">
            {phone}
          </span>
          {contextMeta ? (
            <span className="mt-0.5 block truncate text-[11px] text-slate-400">{contextMeta}</span>
          ) : call.lookupLoading ? (
            <span className="mt-0.5 block text-[11px] text-slate-500">Looking up caller…</span>
          ) : null}
        </span>

        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            ringing
              ? "animate-pulse bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.95)]"
              : "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]"
          )}
          aria-hidden
        />
      </button>
    </div>
  )
})
