"use client"

// Admin modal — invite a platform receptionist via server action + optional Resend email.

import { useState } from "react"
import { Copy, Loader2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { inviteReceptionist } from "@/app/actions/admin-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function AdminInviteReceptionistDialog() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [payoutRate, setPayoutRate] = useState("2.50")
  const [busy, setBusy] = useState(false)
  const [signupUrl, setSignupUrl] = useState<string | null>(null)

  function resetForm() {
    setEmail("")
    setFirstName("")
    setPayoutRate("2.50")
    setSignupUrl(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const result = await inviteReceptionist(email, firstName, Number(payoutRate))
      if (!result.ok) throw new Error(result.error)
      setSignupUrl(result.signup_url)
      if (result.email_sent) {
        toast.success(`Invite emailed to ${result.email}`)
      } else {
        toast.success(`Invite created for ${result.email}`)
        if (result.email_error) {
          toast.message("Copy the signup link — email not sent", { description: result.email_error })
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed")
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!signupUrl) return
    try {
      await navigator.clipboard.writeText(signupUrl)
      toast.success("Invite link copied")
    } catch {
      toast.error("Could not copy link")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="bg-violet-600 text-white hover:bg-violet-500">
          <UserPlus className="mr-2 h-4 w-4" aria-hidden />
          Invite receptionist
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite receptionist</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Creates a secure signup token locked to the receptionist role. Sends email when RESEND_API_KEY is set.
          </DialogDescription>
        </DialogHeader>

        {signupUrl ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-foreground">
              Share this one-time link with <span className="font-medium text-white">{email}</span>:
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={signupUrl}
                className="border-border bg-background/80 font-mono text-xs text-foreground"
              />
              <Button type="button" variant="outline" className="shrink-0 border-border" onClick={() => void copyLink()}>
                <Copy className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="border-border" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4 py-2" onSubmit={(e) => void handleSubmit(e)}>
            <div className="space-y-2">
              <Label htmlFor="invite-email" className="text-foreground">
                Email
              </Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                className="border-border bg-background/80 text-foreground"
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-first-name" className="text-foreground">
                First name
              </Label>
              <Input
                id="invite-first-name"
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Alex"
                className="border-border bg-background/80 text-foreground"
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-payout" className="text-foreground">
                Default payout rate (USD)
              </Label>
              <Input
                id="invite-payout"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={payoutRate}
                onChange={(e) => setPayoutRate(e.target.value)}
                className="border-border bg-background/80 text-foreground"
                disabled={busy}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" className="border-border" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-violet-600 hover:bg-violet-500" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Creating…
                  </>
                ) : (
                  "Create invite"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
