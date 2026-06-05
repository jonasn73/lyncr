"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Check, Copy, Link2, Loader2 } from "lucide-react"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { dispatchBusinessNumbersChanged } from "@/components/dashboard-numbers-modal-context"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { useToast } from "@/hooks/use-toast"

type Props = {
  onBack: () => void
  onLinked?: () => void
}

export function LinkExternalNumberPanel({ onBack, onLinked }: Props) {
  const { toast } = useToast()
  const [webhookUrl, setWebhookUrl] = useState<string>("")
  const [label, setLabel] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch("/api/numbers/external", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { texml_webhook_url?: string } }) => {
        if (j?.data?.texml_webhook_url) setWebhookUrl(j.data.texml_webhook_url)
      })
      .catch(() => {
        const origin = typeof window !== "undefined" ? window.location.origin : ""
        if (origin) setWebhookUrl(`${origin}/api/voice/telnyx/incoming`)
      })
  }, [])

  const copyWebhook = useCallback(async () => {
    if (!webhookUrl) return
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      toast({ title: "Webhook URL copied" })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: "Copy failed", variant: "destructive" })
    }
  }, [webhookUrl, toast])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/numbers/external", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: readActiveOrganizationId(),
          label: label.trim(),
          number: phone.trim(),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.success === false) {
        throw new Error(j.error || "Could not link number")
      }
      dispatchBusinessNumbersChanged()
      toast({
        title: "External line linked",
        description: `${formatPhoneDisplay(phone)} is active — point Twilio voice webhooks at the URL below.`,
      })
      onLinked?.()
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link number")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/60 px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to buy a number
        </button>
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Link2 className="h-4 w-4 text-violet-400" aria-hidden />
          Link your existing Twilio line instantly
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          No port required. Forward voice traffic from Twilio (or any carrier) to Lyncr using our TeXML webhook.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">
            TeXML webhook endpoint
          </p>
          <p className="mt-2 break-all rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-[11px] text-zinc-200">
            {webhookUrl || "Loading…"}
          </p>
          <button
            type="button"
            onClick={() => void copyWebhook()}
            disabled={!webhookUrl}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Copy webhook URL
          </button>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            In Twilio: Phone Numbers → your line → Voice configuration → set <strong className="text-zinc-400">A call comes in</strong>{" "}
            to <strong className="text-zinc-400">Webhook</strong>, method <strong className="text-zinc-400">POST</strong>, and paste the URL above.
          </p>
        </div>

        <form onSubmit={save} className="mt-5 space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Line label
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={120}
              placeholder="Key Squad 502 Line"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Phone number
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              required
              placeholder="+15025550194"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          {error ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white",
              "hover:bg-violet-500 disabled:opacity-60"
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save external line
          </button>
        </form>
      </div>
    </div>
  )
}
