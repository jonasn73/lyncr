"use client"

// Settings sheet: the AI phone assistant's greeting + notes — the one Settings surface
// every industry gets today for their AI call script (the job-type branches themselves
// are auto-selected from the account's industry and need no per-account editing).

import { useEffect, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { industryShortLabel, isAiIntakeProfileId, type AiIntakeProfileId } from "@/lib/business-industries"

type AiAssistantGetResponse = {
  hasAssistant?: boolean
  intakeConfig?: {
    profileId?: string
    busyGreeting?: string
    carKeyNotes?: string
    lockoutNotes?: string
    otherNotes?: string
    extraAiInstructions?: string
  }
  error?: string
}

export function AiScriptSettingsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasAssistant, setHasAssistant] = useState(false)
  const [profileId, setProfileId] = useState<AiIntakeProfileId>("generic")
  const [busyGreeting, setBusyGreeting] = useState("")
  const [carKeyNotes, setCarKeyNotes] = useState("")
  const [lockoutNotes, setLockoutNotes] = useState("")
  const [otherNotes, setOtherNotes] = useState("")
  const [extraAiInstructions, setExtraAiInstructions] = useState("")

  const isLocksmith = profileId === "locksmith"

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch("/api/ai-assistant", { credentials: "include", cache: "no-store" })
        const json = (await res.json().catch(() => ({}))) as AiAssistantGetResponse
        if (cancelled) return
        if (!res.ok) throw new Error(json.error || "Could not load AI assistant settings")
        setHasAssistant(json.hasAssistant === true)
        const cfg = json.intakeConfig || {}
        setProfileId(isAiIntakeProfileId(cfg.profileId || "") ? (cfg.profileId as AiIntakeProfileId) : "generic")
        setBusyGreeting(cfg.busyGreeting?.trim() || "")
        setCarKeyNotes(cfg.carKeyNotes?.trim() || "")
        setLockoutNotes(cfg.lockoutNotes?.trim() || "")
        setOtherNotes(cfg.otherNotes?.trim() || "")
        setExtraAiInstructions(cfg.extraAiInstructions?.trim() || "")
      } catch (e) {
        if (!cancelled) {
          toast({
            title: "Could not load AI assistant settings",
            description: e instanceof Error ? e.message : "Try again",
            variant: "destructive",
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, toast])

  async function save() {
    setSaving(true)
    try {
      const intake: Record<string, string> = {
        busyGreeting: busyGreeting.trim(),
        otherNotes: otherNotes.trim(),
        extraAiInstructions: extraAiInstructions.trim(),
      }
      if (isLocksmith) {
        intake.carKeyNotes = carKeyNotes.trim()
        intake.lockoutNotes = lockoutNotes.trim()
      }
      const res = await fetch("/api/ai-assistant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ intake }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not save")
      toast({ title: "AI assistant settings saved" })
      onOpenChange(false)
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl border-border bg-[#101018] p-0"
      >
        <SheetHeader className="shrink-0 border-b border-border px-4 pb-3 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            AI phone assistant
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            What the AI says and asks about when no one answers. Job-type questions are already
            tailored to {industryShortLabel(profileId)} automatically — these fields just cover
            the greeting and any extra notes.
          </p>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : (
            <>
              {!hasAssistant ? (
                <div className="rounded-xl border border-border bg-background/50 px-3 py-3 text-2xs text-muted-foreground">
                  Your AI assistant isn't turned on yet (Call routing → AI fallback). These settings
                  are saved now and take effect as soon as it is.
                </div>
              ) : null}

              <label className="block rounded-xl border border-border bg-background/50 px-3 py-3">
                <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  Greeting
                </span>
                <Textarea
                  value={busyGreeting}
                  onChange={(e) => setBusyGreeting(e.target.value)}
                  placeholder="Thanks for calling — we're juggling a few jobs right now…"
                  rows={3}
                  className="mt-1.5 border-border bg-background text-sm text-foreground"
                />
              </label>

              {isLocksmith ? (
                <>
                  <label className="block rounded-xl border border-border bg-background/50 px-3 py-3">
                    <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                      Car key notes
                    </span>
                    <Textarea
                      value={carKeyNotes}
                      onChange={(e) => setCarKeyNotes(e.target.value)}
                      placeholder="Optional — anything the AI should know for car key calls"
                      rows={2}
                      className="mt-1.5 border-border bg-background text-sm text-foreground"
                    />
                  </label>
                  <label className="block rounded-xl border border-border bg-background/50 px-3 py-3">
                    <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                      Lockout notes
                    </span>
                    <Textarea
                      value={lockoutNotes}
                      onChange={(e) => setLockoutNotes(e.target.value)}
                      placeholder="Optional — anything the AI should know for lockout calls"
                      rows={2}
                      className="mt-1.5 border-border bg-background text-sm text-foreground"
                    />
                  </label>
                </>
              ) : (
                <label className="block rounded-xl border border-border bg-background/50 px-3 py-3">
                  <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                    Additional notes for the AI
                  </span>
                  <Textarea
                    value={otherNotes}
                    onChange={(e) => setOtherNotes(e.target.value)}
                    placeholder="Optional — anything the AI should mention or ask about"
                    rows={2}
                    className="mt-1.5 border-border bg-background text-sm text-foreground"
                  />
                </label>
              )}

              <label className="block rounded-xl border border-border bg-background/50 px-3 py-3">
                <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  Advanced: extra instructions
                </span>
                <Textarea
                  value={extraAiInstructions}
                  onChange={(e) => setExtraAiInstructions(e.target.value)}
                  placeholder="Optional — raw instructions appended to the AI's script"
                  rows={2}
                  className="mt-1.5 border-border bg-background text-sm text-foreground"
                />
              </label>

              <Button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="h-11 w-full bg-success text-sm font-semibold text-success-foreground hover:bg-success"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Save"}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
