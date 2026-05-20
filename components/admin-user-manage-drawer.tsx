"use client"

// Advanced operator drawer — status, notes, manual DID, hard reset.

import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { LyncrAdminDirectoryRow } from "@/lib/types"
import { ACCOUNT_STATUSES, accountStatusLabel } from "@/lib/account-status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export function AdminUserManageDrawer({
  row,
  open,
  onOpenChange,
  fetchLatestAdminStats,
}: {
  row: LyncrAdminDirectoryRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  fetchLatestAdminStats: (silent?: boolean) => Promise<void>
}) {
  const [targetStatus, setTargetStatus] = useState("active")
  const [adminNotes, setAdminNotes] = useState("")
  const [manualPhone, setManualPhone] = useState("")
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    if (!row) return
    setTargetStatus(row.account_status || "active")
    setAdminNotes(row.custom_routing_note ?? "")
    setManualPhone(row.phone_number ?? "")
  }, [row])

  async function handleSaveSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await saveOverrides()
  }

  async function saveOverrides() {
    if (!row) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/user-override", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: row.user_id,
          targetStatus,
          adminNotes,
          manualPhoneOverride: manualPhone.trim() || null,
        }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Save failed")
      toast.success("User overrides saved")
      await fetchLatestAdminStats(true)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function resetActiveLines() {
    if (!row) return
    setResetting(true)
    try {
      const res = await fetch("/api/admin/user-override", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.user_id, resetActiveLines: true }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Reset failed")
      toast.success("Active lines cleared and balance reset to $0.00")
      await fetchLatestAdminStats(true)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed")
    } finally {
      setResetting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-slate-800 bg-[#0b1120] text-slate-100 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-slate-50">Advanced user management</SheetTitle>
          <SheetDescription className="text-slate-400">
            {row ? `${row.email} · ${row.user_id}` : "Select a user"}
          </SheetDescription>
        </SheetHeader>

        {row ? (
          <form
            id="admin-user-override-form"
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-2"
            onSubmit={(e) => void handleSaveSubmit(e)}
          >
            <div className="space-y-2">
              <Label className="text-slate-300">Account status</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Account status">
                {ACCOUNT_STATUSES.map((s) => {
                  const selected = targetStatus === s
                  return (
                    <Button
                      key={s}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={selected}
                      className={cn(
                        "border-slate-700",
                        selected && s === "active" && "border-emerald-600 bg-emerald-600/20 text-emerald-200",
                        selected && s === "suspended" && "border-red-600 bg-red-600/20 text-red-200",
                        selected && s === "flagged" && "border-amber-600 bg-amber-600/20 text-amber-200",
                        !selected && "bg-slate-950 text-slate-300 hover:bg-slate-900"
                      )}
                      onClick={() => setTargetStatus(s)}
                    >
                      {accountStatusLabel(s)}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-slate-500">
                Suspended accounts cannot receive or route calls until reactivated.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Custom admin routing notes</Label>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="e.g. VIP client — manual billing clear"
                className="min-h-[100px] border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Direct phone assignment (Telnyx DID)</Label>
              <Input
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                placeholder="+15551234567"
                className="border-slate-700 bg-slate-950 font-mono text-slate-100"
              />
              <p className="text-xs text-slate-500">Bypasses self-service purchase — assigns or updates the primary active line.</p>
            </div>

            <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4">
              <p className="text-sm font-medium text-red-200">Danger zone</p>
              <p className="mt-1 text-xs text-red-200/70">
                Removes all active phone numbers and sets carrier credit to $0.00.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="mt-3"
                    disabled={resetting}
                  >
                    {resetting ? "Resetting..." : "Reset active lines"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-slate-800 bg-slate-900 text-slate-100">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset active lines?</AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-400">
                      This permanently removes {row.email}&apos;s assigned numbers and zeroes their carrier credit.
                      This cannot be undone from the admin console.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-slate-700 bg-slate-950">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={(e) => {
                        e.preventDefault()
                        void resetActiveLines()
                      }}
                    >
                      Yes, reset account lines
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </form>
        ) : null}

        <SheetFooter className="border-t border-slate-800 pt-4">
          <Button
            type="button"
            variant="outline"
            className="border-slate-700 text-slate-200"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="admin-user-override-form"
            className="bg-violet-600 hover:bg-violet-500"
            disabled={!row || saving}
          >
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
