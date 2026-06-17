"use client"

import { useEffect, useState } from "react"
import { HardHat, Loader2, Zap } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export type AdminProvisionTechnicianModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Business owner users.id — bound to field_technicians.user_id. */
  ownerUserId: string
  /** Organization workspace id or legacy-{ownerUserId} fallback. */
  workspaceId: string
  /** Shown in the modal subtitle for operator confirmation. */
  ownerEmail?: string | null
  /** Called after a successful manual provision. */
  onSuccess?: () => void
}

/** Platform-admin modal: instantly add a field tech to a specific business roster. */
export function AdminProvisionTechnicianModal({
  open,
  onOpenChange,
  ownerUserId,
  workspaceId,
  ownerEmail,
  onSuccess,
}: AdminProvisionTechnicianModalProps) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName("")
      setPhone("")
      setError(null)
      setBusy(false)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/team/technicians", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-lyncr-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          isManual: true,
          workspaceId,
          businessId: ownerUserId,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean }
      if (!res.ok || json.success === false) {
        setError(json.error || "Could not provision technician")
        return
      }
      onSuccess?.()
      onOpenChange(false)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-[#0b1120] text-slate-100 sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-50">
            <HardHat className="h-5 w-5 text-violet-300" aria-hidden />
            Provision field technician
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {ownerEmail
              ? `Instantly add an active tech to ${ownerEmail}'s roster — no SMS invite required.`
              : "Instantly add an active tech to this business roster — no SMS invite required."}
          </DialogDescription>
        </DialogHeader>

        <form className="mt-2 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label className="text-slate-300">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Rivera"
              required
              minLength={2}
              className="border-slate-700 bg-slate-950 text-slate-100"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Phone number</Label>
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(502) 555-0100"
              required
              className="border-slate-700 bg-slate-950 text-slate-100"
            />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <Button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Zap className="h-4 w-4" aria-hidden />
            )}
            Add Technician Instantly
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Pick the workspace id to bind when provisioning from the admin drawer. */
export function resolveAdminProvisionWorkspaceId(
  ownerUserId: string,
  organizations: { id: string; is_default?: boolean }[] | undefined
): string {
  const orgs = organizations ?? []
  const defaultOrg = orgs.find((o) => o.is_default) ?? orgs[0]
  if (defaultOrg?.id) return defaultOrg.id
  return `legacy-${ownerUserId}`
}
