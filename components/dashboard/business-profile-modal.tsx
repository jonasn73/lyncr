"use client"

import { useEffect, useState } from "react"
import { FileAudio, Loader2, MessageSquare, Smartphone } from "lucide-react"
import { updateNotificationPreferences } from "@/app/actions/notification-preferences"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { workspaceFieldClass } from "@/components/dashboard-workspace-ui"
import { useToast } from "@/hooks/use-toast"
import { submitFormEvent } from "@/lib/form-keyboard"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName?: string
  initialEmail?: string
  initialBusinessName?: string
  initialSmsLeadsEnabled?: boolean
  /** SMS when Latest / recent activity needs attention. */
  initialSmsLatestEnabled?: boolean
  initialDispatchSmsPhone?: string
  initialEmailRecordingsEnabled?: boolean
  companyUserId?: string
}

export function BusinessProfileModal({
  open,
  onOpenChange,
  initialName = "",
  initialEmail = "",
  initialBusinessName = "",
  initialSmsLeadsEnabled = false,
  initialSmsLatestEnabled = false,
  initialDispatchSmsPhone = "",
  initialEmailRecordingsEnabled = false,
  companyUserId = "",
}: Props) {
  const { toast } = useToast()
  // Local copy of the business name while the user edits it.
  const [businessName, setBusinessName] = useState(initialBusinessName)
  // SMS lead-alert toggle (instant texts for new leads).
  const [smsLeadsEnabled, setSmsLeadsEnabled] = useState(initialSmsLeadsEnabled)
  // SMS when Latest / recent activity needs attention.
  const [smsLatestEnabled, setSmsLatestEnabled] = useState(initialSmsLatestEnabled)
  // Cell number where dispatch SMS alerts are sent.
  const [dispatchSmsPhone, setDispatchSmsPhone] = useState(initialDispatchSmsPhone)
  // Email call recordings toggle (saves immediately on flip — not part of Save profile).
  const [emailRecordingsEnabled, setEmailRecordingsEnabled] = useState(initialEmailRecordingsEnabled)
  // One saving spinner for the whole sheet (name + notification settings).
  const [saving, setSaving] = useState(false)

  // When the sheet opens (or props refresh), reset fields to the latest server values.
  useEffect(() => {
    if (!open) return
    setBusinessName(initialBusinessName)
    setSmsLeadsEnabled(initialSmsLeadsEnabled)
    setSmsLatestEnabled(initialSmsLatestEnabled)
    setDispatchSmsPhone(initialDispatchSmsPhone)
    setEmailRecordingsEnabled(initialEmailRecordingsEnabled)
  }, [
    open,
    initialBusinessName,
    initialSmsLeadsEnabled,
    initialSmsLatestEnabled,
    initialDispatchSmsPhone,
    initialEmailRecordingsEnabled,
  ])

  // One Save: persist business name AND notification settings together.
  async function saveProfile() {
    // Need a company id for notification preferences.
    if (!companyUserId) return
    // Show the Saving… state on the button.
    setSaving(true)
    try {
      // Empty name falls back to a friendly default.
      const trimmed = businessName.trim() || "My Business"
      // Save the business name via the profile API.
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ business_name: trimmed }),
      })
      // Bail if the name save failed.
      if (!res.ok) throw new Error("Could not save business name")
      // Keep the local field in sync with what we just saved.
      setBusinessName(trimmed)

      // Save SMS / notification toggles + dispatch phone.
      const result = await updateNotificationPreferences(
        companyUserId,
        smsLeadsEnabled,
        dispatchSmsPhone,
        smsLatestEnabled
      )
      // Bail if notification save failed.
      if (!result.ok) throw new Error(result.error)

      // Tell the user everything stuck, then close the sheet.
      toast({ title: "Profile saved" })
      onOpenChange(false)
    } catch (e) {
      // Show a clear error if either save step failed.
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      // Always clear the spinner.
      setSaving(false)
    }
  }

  // Email recordings still saves right when the switch flips (separate from Save profile).
  async function toggleEmailRecordings(next: boolean) {
    setEmailRecordingsEnabled(next)
    try {
      const res = await fetch("/api/settings/email-recordings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_recordings_enabled: next }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { email_recordings_enabled?: boolean }
        error?: string
      }
      if (!res.ok) throw new Error(json.error || "Could not save")
      setEmailRecordingsEnabled(json.data?.email_recordings_enabled === true)
    } catch (e) {
      toast({
        title: "Could not update email recordings",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(92vh,900px)] overflow-hidden border-border/80 bg-card/95 sm:max-w-lg"
        // Don't autofocus the first field — on mobile that selects all business-name text.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Business profile</DialogTitle>
          <DialogDescription>
            {initialName ? `${initialName} · ${initialEmail}` : "Your account and SMS alert delivery settings."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-8rem)] space-y-5 overflow-y-auto pr-1">
          {/* One form so Enter in any field runs the same Save profile action. */}
          <form
            className="space-y-5"
            onSubmit={(e) => {
              submitFormEvent(e)
              if (!saving) void saveProfile()
            }}
          >
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Business name
              </span>
              <input
                className={workspaceFieldClass}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                maxLength={120}
                // Collapse select-all if the browser still highlights everything on focus/tap.
                onFocus={(e) => {
                  const el = e.currentTarget
                  const len = el.value.length
                  // Only undo full-selection (autofocus/select-all), not a real caret tap.
                  requestAnimationFrame(() => {
                    if (document.activeElement !== el || len === 0) return
                    if (el.selectionStart === 0 && el.selectionEnd === len) {
                      el.setSelectionRange(len, len)
                    }
                  })
                }}
              />
            </label>

            <div className="space-y-3 border-t border-border/60 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">SMS alerts</p>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                <div className="flex items-start gap-3">
                  <Smartphone className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-foreground">Instant SMS lead alerts</p>
                    <p className="text-xs text-zinc-500">Texts include caller, service type, and intake notes.</p>
                  </div>
                </div>
                <Switch checked={smsLeadsEnabled} onCheckedChange={setSmsLeadsEnabled} aria-label="SMS lead alerts" />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                <div className="flex items-start gap-3">
                  <MessageSquare className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-foreground">Latest activity SMS reminders</p>
                    <p className="text-xs text-zinc-500">
                      Text you when a customer reply needs an answer, or a finished job still needs Thanks + review.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={smsLatestEnabled}
                  onCheckedChange={setSmsLatestEnabled}
                  aria-label="Latest activity SMS reminders"
                />
              </div>
              <label className="block">
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Dedicated dispatch SMS number
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="(555) 123-4567"
                  className={workspaceFieldClass}
                  value={dispatchSmsPhone}
                  onChange={(e) => setDispatchSmsPhone(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-zinc-500">
                  Your cell where Lyncr texts these alerts. Leave blank to use your profile phone.
                </p>
              </label>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                <div className="flex items-start gap-3">
                  <FileAudio className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-foreground">Email call recordings</p>
                    <p className="text-xs text-zinc-500">MP3 playback files sent to your primary email.</p>
                  </div>
                </div>
                <Switch
                  checked={emailRecordingsEnabled}
                  onCheckedChange={(v) => void toggleEmailRecordings(v)}
                  aria-label="Email recordings"
                />
              </div>
              {/* Single bottom button: saves name + SMS settings together. */}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Saving…
                  </span>
                ) : (
                  "Save profile"
                )}
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
