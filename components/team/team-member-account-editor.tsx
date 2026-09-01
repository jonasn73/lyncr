"use client"

// Owner-facing "Account & security" editor for a receptionist or field tech — real contact
// email, mailing address, setting a new password directly, and locking their login. One form,
// two thin role wrappers (same pattern as ReceptionistAccessEditor / FieldTechAccessEditor).

import { useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Switch } from "@/components/ui/switch"

export interface TeamMemberAccountTarget {
  id: string
  name: string
  phone: string
  contactEmail: string | null
  address: string | null
  accountLocked: boolean
  /** False while they still have a pending invite (no portal_user_id yet) — password/lock need a real login. */
  hasLogin: boolean
}

export interface TeamMemberAccountPatch {
  name: string
  phone: string
  contactEmail: string | null
  address: string | null
  accountLocked: boolean
}

interface TeamMemberAccountEditorProps {
  target: TeamMemberAccountTarget | null
  onClose: () => void
  onSaved: (patch: TeamMemberAccountPatch) => void
}

export function ReceptionistAccountEditor({ target, onClose, onSaved }: TeamMemberAccountEditorProps) {
  if (!target) return null
  return <TeamMemberAccountForm key={target.id} target={target} onClose={onClose} onSaved={onSaved} endpoint="/api/receptionists" />
}

/** Same dialog, the field-tech account routes. */
export function FieldTechAccountEditor({ target, onClose, onSaved }: TeamMemberAccountEditorProps) {
  if (!target) return null
  return <TeamMemberAccountForm key={target.id} target={target} onClose={onClose} onSaved={onSaved} endpoint="/api/technicians" />
}

function TeamMemberAccountForm({
  target,
  onClose,
  onSaved,
  endpoint,
}: {
  target: TeamMemberAccountTarget
  onClose: () => void
  onSaved: (patch: TeamMemberAccountPatch) => void
  /** Collection route the PATCHes go to — `/api/receptionists` or `/api/technicians`. */
  endpoint: string
}) {
  const [name, setName] = useState(target.name)
  const [phone, setPhone] = useState(target.phone)
  const [contactEmail, setContactEmail] = useState(target.contactEmail ?? "")
  const [address, setAddress] = useState(target.address ?? "")
  const [newPassword, setNewPassword] = useState("")
  const [locked, setLocked] = useState(target.accountLocked)
  const [confirmLock, setConfirmLock] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const trimmedName = name.trim()
      const trimmedPhone = phone.trim()
      const trimmedEmail = contactEmail.trim()
      const trimmedAddress = address.trim()
      const trimmedPassword = newPassword.trim()

      if (trimmedName.length < 2) throw new Error("Name is required")
      if (!trimmedPhone) throw new Error("Phone is required")

      const profileBody: Record<string, unknown> = {}
      if (trimmedName !== target.name) profileBody.name = trimmedName
      if (trimmedPhone !== target.phone) profileBody.phone = trimmedPhone
      if (trimmedAddress !== (target.address ?? "")) profileBody.address = trimmedAddress || null
      if (Object.keys(profileBody).length > 0) {
        const res = await fetch(`${endpoint}/${target.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profileBody),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(json.error ?? "Could not update details")
      }

      const accountBody: Record<string, unknown> = {}
      if (trimmedEmail !== (target.contactEmail ?? "")) accountBody.contact_email = trimmedEmail || null
      if (locked !== target.accountLocked) accountBody.account_locked = locked
      if (trimmedPassword) {
        if (trimmedPassword.length < 8) throw new Error("Password must be at least 8 characters")
        accountBody.new_password = trimmedPassword
      }
      if (Object.keys(accountBody).length > 0) {
        const res = await fetch(`${endpoint}/${target.id}/account`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(accountBody),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(json.error ?? "Could not update account")
      }

      onSaved({
        name: trimmedName,
        phone: trimmedPhone,
        contactEmail: trimmedEmail || null,
        address: trimmedAddress || null,
        accountLocked: locked,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-background text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Details &amp; security — {target.name}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Name, contact details, password, and sign-in access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                minLength={2}
                disabled={saving}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Phone</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(502) 555-0100"
                disabled={saving}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="name@example.com"
                disabled={saving}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <p className="text-2xs text-muted-foreground">Used for confirmation emails — not their sign-in.</p>
            </label>

            <label className="block space-y-1.5">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Address</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, City, ST 00000"
                disabled={saving}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </label>

            {target.hasLogin ? (
              <>
                <label className="block space-y-1.5 border-t border-border pt-4">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Set a new password
                  </span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Leave blank to keep their current password"
                    minLength={8}
                    disabled={saving}
                    className="w-full rounded-lg border border-border bg-card/50 px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <p className="text-2xs text-muted-foreground">Takes effect immediately — at least 8 characters.</p>
                </label>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3.5 py-3">
                  <div className="pr-3">
                    <p className="text-sm font-medium text-foreground">Lock account</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Blocks sign-in right away. Toggle off to restore access.
                    </p>
                  </div>
                  <Switch
                    checked={locked}
                    disabled={saving}
                    onCheckedChange={(next) => {
                      if (next) setConfirmLock(true)
                      else setLocked(false)
                    }}
                  />
                </div>
              </>
            ) : (
              <p className="border-t border-border pt-4 text-xs text-muted-foreground">
                Password and lock controls appear once they finish setting up their login.
              </p>
            )}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmLock} onOpenChange={setConfirmLock}>
        <AlertDialogContent className="border-border bg-background text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Lock {target.name}&rsquo;s account?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              They&rsquo;ll be signed out and can&rsquo;t log back in until you unlock it. This takes effect once you
              save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-card">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                setLocked(true)
                setConfirmLock(false)
              }}
            >
              Lock account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
