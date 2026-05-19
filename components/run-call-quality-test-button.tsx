"use client"

import { useCallback, useState } from "react"
import { AudioWaveform, Headphones, Loader2, RadioTower } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type RunCallQualityTestButtonProps = {
  /** Active business line E.164 — outbound caller ID for the diagnostics call. */
  businessNumber: string
  /** Disable when the carrier line is not live yet. */
  disabled?: boolean
  className?: string
}

/** Dashboard card — dials forwarding_phone_number and runs the TeXML audio diagnostics loop. */
export function RunCallQualityTestButton({
  businessNumber,
  disabled = false,
  className,
}: RunCallQualityTestButtonProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [caption, setCaption] = useState<string | null>(null)

  const runTest = useCallback(async () => {
    if (loading || disabled || !businessNumber.trim()) return
    setLoading(true)
    setCaption("Calling your connected device now… please answer to verify voice line quality.")
    toast({
      title: "Starting audio diagnostics",
      description: "Calling your connected device now… please answer to verify voice line quality.",
    })

    try {
      const res = await fetch("/api/voice/test-echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ business_number: businessNumber.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: { message?: string }
      }

      if (!res.ok) {
        setCaption(null)
        toast({
          title: "Audio diagnostics could not start",
          description: String(data.error || "Try again in a moment."),
          variant: "destructive",
        })
        return
      }

      setCaption(
        data.data?.message ||
          "Call queued. Answer your phone, record after the beep, and listen for playback twice."
      )
      toast({
        title: "Diagnostics call queued",
        description:
          data.data?.message ||
          "Answer your phone to complete the Lyncr audio quality check.",
      })
    } catch {
      setCaption(null)
      toast({
        title: "Audio diagnostics could not start",
        description: "Network error — check your connection and try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [businessNumber, disabled, loading, toast])

  return (
    <div
      className={cn(
        "w-full rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 via-card/80 to-background/90 p-4 shadow-[0_0_32px_-16px_var(--primary)]",
        className
      )}
    >
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/35 bg-primary/15 shadow-[0_0_18px_-6px_var(--primary)]">
          <RadioTower className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Audio Diagnostics</p>
          <p className="text-xs text-muted-foreground">Verify latency, clarity, and packet quality on your line</p>
        </div>
        <AudioWaveform className="h-5 w-5 shrink-0 text-primary/60" aria-hidden />
      </div>

      <button
        type="button"
        onClick={() => void runTest()}
        disabled={disabled || loading || !businessNumber.trim()}
        aria-busy={loading}
        className={cn(
          "group inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
          "transition-[border-color,background-color,box-shadow,opacity] duration-200",
          "hover:bg-primary/90 hover:shadow-[0_0_28px_-10px_var(--primary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Headphones className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span>{loading ? "Calling your device…" : "Run Audio Diagnostics Check"}</span>
      </button>

      {caption ? (
        <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  )
}
