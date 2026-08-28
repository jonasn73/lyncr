"use client"

// Review / edit appointment confirmation SMS before it sends (intake book flow).

import { useMemo, useState } from "react"
import { Loader2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

type AppointmentConfirmSmsPanelProps = {
  toPhone: string
  fromLine?: string | null
  organizationId?: string | null
  leadId?: string | null
  /** Server-built confirmation draft. */
  draftText: string
  customerFirstName?: string
  appointmentLabel?: string | null
  className?: string
  onSent: () => void
  onSkip: () => void
}

type PresetId = "default" | "short" | "custom"

export function AppointmentConfirmSmsPanel({
  toPhone,
  fromLine = null,
  organizationId = null,
  leadId = null,
  draftText,
  customerFirstName = "there",
  appointmentLabel = null,
  className,
  onSent,
  onSkip,
}: AppointmentConfirmSmsPanelProps) {
  const { toast } = useToast()
  const shortPreset = useMemo(() => {
    const when = (appointmentLabel || "").trim()
    if (when) {
      return `Hey ${customerFirstName} — we got your request for ${when}. We’ll follow up here. Text us here for any update or change.`
    }
    return `Hey ${customerFirstName} — we got your request. We’ll follow up here. Text us here for any update or change.`
  }, [appointmentLabel, customerFirstName])

  const [preset, setPreset] = useState<PresetId>("default")
  const [text, setText] = useState(draftText)
  const [sending, setSending] = useState(false)

  function applyPreset(next: PresetId) {
    setPreset(next)
    if (next === "default") setText(draftText)
    else if (next === "short") setText(shortPreset)
    // custom — keep current text so the operator can edit freely
  }

  async function sendConfirmation() {
    const body = text.trim()
    if (!body) {
      toast({
        title: "Message is empty",
        description: "Edit the text or pick a preset before sending.",
        variant: "destructive",
      })
      return
    }
    if (!toPhone.trim()) {
      toast({
        title: "No phone on file",
        description: "Cannot send confirmation without a customer number.",
        variant: "destructive",
      })
      return
    }
    setSending(true)
    try {
      const res = await fetch("/api/messaging/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toPhone,
          text: body,
          from_number: fromLine?.trim() || undefined,
          organization_id:
            organizationId && !organizationId.startsWith("legacy-")
              ? organizationId
              : undefined,
          lead_id: leadId?.trim() || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast({
          title: "SMS failed",
          description: json.error || "Could not send confirmation.",
          variant: "destructive",
        })
        return
      }
      toast({ title: "Confirmation sent", description: "Customer received your text." })
      onSent()
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border border-warning/35 bg-warning/10 p-4 text-left",
        className
      )}
    >
      <div className="flex items-start gap-2">
        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-warning">Confirm SMS before sending</p>
          <p className="mt-0.5 text-xs text-warning/75">
            Review the message to {formatPhoneDisplay(toPhone)}. Edit anything that looks wrong.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "default" as const, label: "Full confirmation" },
            { id: "short" as const, label: "Short" },
            { id: "custom" as const, label: "Custom" },
          ] as const
        ).map((chip) => (
          <button
            key={chip.id}
            type="button"
            disabled={sending}
            onClick={() => applyPreset(chip.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-2xs font-semibold transition-colors disabled:opacity-50",
              preset === chip.id
                ? "border-warning/60 bg-warning/25 text-warning"
                : "border-warning/25 bg-background/40 text-warning/80 hover:bg-warning/15"
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="sr-only">Confirmation SMS text</span>
        <textarea
          rows={5}
          value={text}
          disabled={sending}
          onChange={(e) => {
            setPreset("custom")
            setText(e.target.value)
          }}
          className="w-full resize-y rounded-lg border border-warning/30 bg-background/70 px-3 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-warning/50 focus:outline-none disabled:opacity-60"
        />
      </label>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className="h-11 flex-1 bg-success font-semibold text-success-foreground hover:bg-success"
          disabled={sending || !text.trim()}
          onClick={() => void sendConfirmation()}
        >
          {sending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Sending…
            </>
          ) : (
            "Send confirmation SMS"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 border-warning/30 bg-transparent text-warning hover:bg-warning/10"
          disabled={sending}
          onClick={onSkip}
        >
          Skip SMS
        </Button>
      </div>
    </div>
  )
}
