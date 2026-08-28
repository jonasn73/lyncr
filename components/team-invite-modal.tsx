"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Check, Copy, Loader2, Phone, UserPlus } from "lucide-react"
import { submitFormEvent } from "@/lib/form-keyboard"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { notifyTeamRosterChanged } from "@/lib/team-invite-events"

type AddMode = "phone" | "invite"

type InviteSuccess = {
  register_url: string
  email: string
  email_sent: boolean
  email_error: string | null
}

export function TeamInviteModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [mode, setMode] = useState<AddMode>("phone")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phoneDone, setPhoneDone] = useState(false)
  const [inviteDone, setInviteDone] = useState<InviteSuccess | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) {
      setMode("phone")
      setName("")
      setPhone("")
      setEmail("")
      setBusy(false)
      setError(null)
      setPhoneDone(false)
      setInviteDone(null)
      setCopied(false)
    }
  }, [open])

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Could not copy — select the link and copy it manually.")
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    submitFormEvent(e)
    setBusy(true)
    setError(null)
    try {
      if (mode === "phone") {
        const res = await fetch("/api/receptionists", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          setError(json.error || "Could not add phone contact")
          return
        }
        notifyTeamRosterChanged({ action: "added" })
        setPhoneDone(true)
        return
      }

      const res = await fetch("/api/team/invites", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: InviteSuccess & { register_url?: string }
      }
      if (!res.ok || !json.data?.register_url) {
        setError(json.error || "Could not create invite")
        return
      }
      notifyTeamRosterChanged({ action: "added" })
      setInviteDone({
        register_url: json.data.register_url,
        email: json.data.email,
        email_sent: Boolean(json.data.email_sent),
        email_error: json.data.email_error ?? null,
      })
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const showForm = !phoneDone && !inviteDone

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sigo-marketplace-dialog sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Add someone who answers</DialogTitle>
          <DialogDescription>
            Add a phone contact to forward calls, or send an invite so they can sign in at /receptionist.
          </DialogDescription>
        </DialogHeader>

        {showForm ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("phone")
                  setError(null)
                }}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold transition-colors",
                  mode === "phone"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Phone className="h-3.5 w-3.5" aria-hidden />
                Phone contact
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("invite")
                  setError(null)
                }}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold transition-colors",
                  mode === "invite"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden />
                Invite to app
              </button>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {mode === "phone"
                ? "This forwards calls when you set Who answers → pick them (Custom Routing). They do not need a Lyncr login."
                : "They get a signup link. After they accept, they land on the receptionist portal for your business."}
            </p>

            <form className="mt-3 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
              <label className="block space-y-2">
                <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </label>

              {mode === "phone" ? (
                <label className="block space-y-2">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Mobile number
                  </span>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(502) 555-0100"
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </label>
              ) : (
                <>
                  <label className="block space-y-2">
                    <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="alex@example.com"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Cell (optional)
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(502) 555-0100"
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </label>
                </>
              )}

              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-[var(--electric-glow)] hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {busy
                  ? mode === "phone"
                    ? "Adding…"
                    : "Creating invite…"
                  : mode === "phone"
                    ? "Add phone contact"
                    : "Create invite link"}
              </button>
            </form>
          </>
        ) : null}

        {phoneDone ? (
          <div className="mt-2 space-y-4">
            <p className="rounded-lg border border-emerald-600/30 bg-emerald-950/30 px-3 py-3 text-sm text-emerald-100">
              Saved. Next: open <span className="font-semibold">Who answers</span> on Routing and pick them so calls
              forward to their phone.
            </p>
            <Link
              href="/dashboard"
              onClick={() => onOpenChange(false)}
              className="inline-flex w-full items-center justify-center rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Go to Who answers
            </Link>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-full text-center text-xs text-muted-foreground hover:text-zinc-300"
            >
              Close
            </button>
          </div>
        ) : null}

        {inviteDone ? (
          <div className="mt-2 space-y-4">
            <p className="text-sm text-zinc-300">
              Invite ready for <span className="font-medium text-foreground">{inviteDone.email}</span>.
              {inviteDone.email_sent
                ? " We also emailed the link."
                : " Email was not sent — copy the link below and share it yourself."}
            </p>
            {!inviteDone.email_sent && inviteDone.email_error ? (
              <p className="rounded-lg border border-amber-600/30 bg-amber-950/25 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
                {inviteDone.email_error}
              </p>
            ) : null}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
              <p className="break-all text-xs text-muted-foreground">{inviteDone.register_url}</p>
            </div>
            <button
              type="button"
              onClick={() => void copyLink(inviteDone.register_url)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied ? "Copied!" : "Copy link"}
            </button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              After they accept, set Who answers → pick them (or Custom Routing) so inbound calls reach them.
            </p>
            <Link
              href="/dashboard"
              onClick={() => onOpenChange(false)}
              className="inline-flex w-full items-center justify-center rounded-lg border border-zinc-700 py-3 text-sm font-semibold text-foreground hover:bg-zinc-900"
            >
              Go to Who answers
            </Link>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
