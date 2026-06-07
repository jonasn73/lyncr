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
  initialDispatchSmsPhone = "",
  initialEmailRecordingsEnabled = false,
  companyUserId = "",
}: Props) {
  const { toast } = useToast()
  const [businessName, setBusinessName] = useState(initialBusinessName)
  const [businessNameSaving, setBusinessNameSaving] = useState(false)
  const [smsLeadsEnabled, setSmsLeadsEnabled] = useState(initialSmsLeadsEnabled)
  const [dispatchSmsPhone, setDispatchSmsPhone] = useState(initialDispatchSmsPhone)
  const [emailRecordingsEnabled, setEmailRecordingsEnabled] = useState(initialEmailRecordingsEnabled)
  const [notificationSaving, setNotificationSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setBusinessName(initialBusinessName)
    setSmsLeadsEnabled(initialSmsLeadsEnabled)
    setDispatchSmsPhone(initialDispatchSmsPhone)
    setEmailRecordingsEnabled(initialEmailRecordingsEnabled)
  }, [open, initialBusinessName, initialSmsLeadsEnabled, initialDispatchSmsPhone, initialEmailRecordingsEnabled])

  async function saveBusinessName() {
    const trimmed = businessName.trim() || "My Business"
    setBusinessNameSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ business_name: trimmed }),
      })
      if (!res.ok) throw new Error("Save failed")
      setBusinessName(trimmed)
      toast({ title: "Business name saved" })
    } catch (e) {
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setBusinessNameSaving(false)
    }
  }

  async function saveNotifications() {
    if (!companyUserId) return
    setNotificationSaving(true)
    try {
      await updateNotificationPreferences(companyUserId, smsLeadsEnabled, dispatchSmsPhone)
      toast({ title: "Notification settings saved" })
      onOpenChange(false)
    } catch (e) {
      toast({
        title: "Could not save notifications",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setNotificationSaving(false)
    }
  }

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
      <DialogContent className="max-h-[min(92vh,900px)] overflow-hidden border-border/80 bg-card/95 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Business profile</DialogTitle>
          <DialogDescription>
            {initialName ? `${initialName} · ${initialEmail}` : "Your account and lead-alert delivery settings."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(92vh-8rem)] space-y-5 overflow-y-auto pr-1">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              submitFormEvent(e)
              if (!businessNameSaving && businessName.trim()) void saveBusinessName()
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
              />
            </label>
            <button
              type="submit"
              disabled={businessNameSaving || !businessName.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {businessNameSaving ? "Saving…" : "Save business name"}
            </button>
          </form>

          <div className="space-y-3 border-t border-border/60 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Lead alerts</p>
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
            <button
              type="button"
              disabled={notificationSaving}
              onClick={() => void saveNotifications()}
              className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {notificationSaving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Saving…
                </span>
              ) : (
                "Save notification settings"
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
