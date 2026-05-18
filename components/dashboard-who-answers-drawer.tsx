"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Plus, User } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import {
  DrawerScrollBody,
  DrawerStepHeader,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import { formatPhoneDisplay, type Contact } from "@/lib/dashboard-routing-utils"

type ReceiverId = "owner" | string

type TeamRow = {
  id: ReceiverId
  name: string
  phone: string
  initials: string
  color?: string
  status: "active" | "forwarding" | "offline"
}

function statusBadge(status: TeamRow["status"]) {
  if (status === "active") {
    return (
      <span className="rounded-full border border-success/40 bg-success/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success shadow-[0_0_10px_-4px_var(--success)]">
        Active
      </span>
    )
  }
  if (status === "forwarding") {
    return (
      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-400/90">
        Forwarding
      </span>
    )
  }
  return (
    <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-500">
      Offline
    </span>
  )
}

export type DashboardWhoAnswersDrawerProps = {
  receptionists: Contact[]
  selectedReceptionistId: string | null
  ownerPhoneDisplay: string
  saveRouting: (updates: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<void>
  onClose: () => void
  onRegisterDiscard?: (discard: () => void) => void
  routingBusinessNumber: string | null
  routingLineDetailLoading?: boolean
}

export function DashboardWhoAnswersDrawer({
  receptionists,
  selectedReceptionistId,
  ownerPhoneDisplay,
  saveRouting,
  onClose,
  onRegisterDiscard,
  routingBusinessNumber,
  routingLineDetailLoading,
}: DashboardWhoAnswersDrawerProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const initialReceiver: ReceiverId = selectedReceptionistId ?? "owner"
  const [primaryId, setPrimaryId] = useState<ReceiverId>(initialReceiver)
  const baselineRef = useRef(initialReceiver)

  useEffect(() => {
    const next = selectedReceptionistId ?? "owner"
    setPrimaryId(next)
    baselineRef.current = next
  }, [selectedReceptionistId])

  const dirty = primaryId !== baselineRef.current

  const rows: TeamRow[] = useMemo(() => {
    const ownerRow: TeamRow = {
      id: "owner",
      name: "Your Phone",
      phone: ownerPhoneDisplay,
      initials: "YO",
      status: primaryId === "owner" ? "active" : receptionists.length > 0 ? "offline" : "forwarding",
    }
    const teamRows: TeamRow[] = receptionists.map((c) => ({
      id: c.id,
      name: c.name,
      phone: formatPhoneDisplay(c.phone),
      initials: c.initials,
      color: c.color,
      status: primaryId === c.id ? "active" : primaryId === "owner" ? "forwarding" : "offline",
    }))
    return [ownerRow, ...teamRows]
  }, [receptionists, ownerPhoneDisplay, primaryId])

  const lineLabel = routingBusinessNumber ? `Line ${formatPhoneDisplay(routingBusinessNumber)}` : null

  const discardEdits = useCallback(() => {
    setPrimaryId(baselineRef.current)
  }, [])

  useEffect(() => {
    onRegisterDiscard?.(discardEdits)
  }, [onRegisterDiscard, discardEdits])

  const handleCancel = useCallback(() => {
    discardEdits()
    onClose()
  }, [discardEdits, onClose])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await saveRouting({
        selected_receptionist_id: primaryId === "owner" ? null : primaryId,
      })
      baselineRef.current = primaryId
      toast({ title: "Saved", description: "Call destination updated for this line." })
      onClose()
    } catch {
      toast({ title: "Could not save", description: "Try again in a moment.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }, [primaryId, saveRouting, onClose, toast])

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        submitFormEvent(e)
        if (!saving) void handleSave()
      }}
    >
      <DrawerStepHeader
        step="Step 2 · Call destination"
        title="Who Answers"
        subtitle="Manage which physical phones or team members ring when a call hits this line."
        lineLabel={lineLabel}
      />
      <DrawerScrollBody className={cn(routingLineDetailLoading && "pointer-events-none opacity-50")}>
        <div className="space-y-2" role="radiogroup" aria-label="Primary call destination">
          {rows.map((row) => {
            const selected = primaryId === row.id
            return (
              <button
                key={row.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPrimaryId(row.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-[border-color,background-color] duration-200",
                  selected
                    ? "border-primary/60 bg-primary/10 shadow-[0_0_24px_-10px_var(--primary)]"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                )}
              >
                {row.id === "owner" ? (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/80">
                    <User className="h-5 w-5 text-zinc-300" aria-hidden />
                  </div>
                ) : (
                  <Avatar className="h-11 w-11 shrink-0">
                    <AvatarFallback className={cn(row.color, "text-xs font-semibold text-primary-foreground")}>
                      {row.initials}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{row.name}</p>
                    {statusBadge(row.status)}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{row.phone}</p>
                </div>
                <div
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200",
                    selected ? "border-primary bg-primary shadow-[0_0_12px_-2px_var(--primary)]" : "border-zinc-600 bg-transparent"
                  )}
                  aria-hidden
                >
                  {selected ? <span className="h-2 w-2 rounded-full bg-primary-foreground" /> : null}
                </div>
              </button>
            )
          })}
        </div>

        <Link
          href="/dashboard/contacts"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-transparent px-4 py-3 text-sm font-semibold text-zinc-400 transition-colors duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add backup number
        </Link>

        {receptionists.length === 0 ? (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-500">
            No team members yet — add contacts on the Team tab, then pick who rings first here.
          </p>
        ) : null}
      </DrawerScrollBody>
      <DrawerStickyFooter
        dirty={dirty}
        saving={saving}
        onSave={() => void handleSave()}
        onCancel={handleCancel}
        saveAsSubmit
      />
    </form>
  )
}
