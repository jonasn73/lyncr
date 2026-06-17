"use client"

import { useEffect, useState } from "react"
import { Loader2, UserPlus, Zap } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { usePlatformAdmin } from "@/hooks/use-platform-admin"
import type { FieldTechnician } from "@/lib/types"

type AddMode = "invite" | "manual"

type InviteResult = {
  name: string
  phone: string
  setup_url: string
  sms_sent: boolean
  sms_error: string | null
  success?: boolean
  errorType?: "10DLC_BLOCK" | "OTHER"
  message?: string
}

export type AddTechnicianModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful create — pass the new row + full roster for instant UI refresh. */
  onSuccess: (result: {
    technician: FieldTechnician
    technicians: FieldTechnician[]
    invite?: InviteResult | null
  }) => void
}

export function AddTechnicianModal({ open, onOpenChange, onSuccess }: AddTechnicianModalProps) {
  const { isPlatformAdmin } = usePlatformAdmin()
  const [mode, setMode] = useState<AddMode>("invite")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setMode("invite")
      setName("")
      setEmail("")
      setPhone("")
      setError(null)
      setBusy(false)
    }
  }, [open])

  useEffect(() => {
    if (!isPlatformAdmin && mode === "manual") {
      setMode("invite")
    }
  }, [isPlatformAdmin, mode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const isManual = mode === "manual" && isPlatformAdmin
    try {
      const res = await fetch("/api/team/technicians", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          ...(isManual ? { isManual: true } : {}),
          ...(!isManual && email.trim() ? { email: email.trim() } : {}),
        }),
      })
      const json = (await res.json()) as {
        error?: string
        success?: boolean
        data?: {
          technician?: FieldTechnician
          technicians?: FieldTechnician[]
          invite?: InviteResult
        }
      }
      if (!res.ok) {
        setError(json.error || "Could not add technician")
        return
      }
      const technician = json.data?.technician
      const technicians = json.data?.technicians
      if (!technician || !Array.isArray(technicians)) {
        setError("Server did not return the new technician row")
        return
      }
      if (!isManual && (json.success === false || json.data?.invite?.success === false)) {
        onSuccess({ technician, technicians, invite: json.data?.invite ?? null })
        onOpenChange(false)
        return
      }
      onSuccess({ technician, technicians, invite: json.data?.invite ?? null })
      onOpenChange(false)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sigo-marketplace-dialog sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Add field technician</DialogTitle>
          <DialogDescription>
            {mode === "manual"
              ? "Add someone to your roster immediately — no invite text required."
              : "We text them a secure link to set their own password."}
          </DialogDescription>
        </DialogHeader>

        {isPlatformAdmin ? (
          <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950/80 p-1">
            <button
              type="button"
              onClick={() => setMode("invite")}
              className={cn(
                "rounded-md px-3 py-2 text-xs font-semibold transition-colors",
                mode === "invite"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Send Invite Link
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={cn(
                "rounded-md px-3 py-2 text-xs font-semibold transition-colors",
                mode === "manual"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              Create Manually
            </button>
          </div>
        ) : null}

        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Rivera"
              required
              minLength={2}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>

          {mode === "invite" ? (
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Email <span className="font-normal normal-case text-zinc-600">(optional)</span>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </label>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Phone number</span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(502) 555-0100"
              required
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </label>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : mode === "manual" ? (
              <Zap className="h-4 w-4" aria-hidden />
            ) : (
              <UserPlus className="h-4 w-4" aria-hidden />
            )}
            {mode === "manual" ? "Add Technician Instantly" : "Send Invitation"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
