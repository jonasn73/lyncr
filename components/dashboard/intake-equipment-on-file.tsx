"use client"

// Equipment on file — compact intake-sheet card for plumbing/HVAC/electrical (087).
// Self-contained (own fetch + edit state) so CallAnsweredModal only needs to mount it —
// deliberately not shared with the fuller CRM panel (crm-workspace-view.tsx), which has
// its own already-tested state; a live call wants the smallest possible surface.

import { useCallback, useEffect, useState } from "react"
import { Pencil, Plus, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { equipmentAwareProfile } from "@/lib/customer-equipment-registry"
import type { CustomerEquipment } from "@/lib/types"

type EquipmentFormState = {
  brand: string
  model: string
  install_year: string
  notes: string
}

const EMPTY_FORM: EquipmentFormState = { brand: "", model: "", install_year: "", notes: "" }

export function IntakeEquipmentOnFile({
  customerId,
  industry,
  className,
}: {
  /** Null until a returning caller is matched — equipment lives on a saved customer. */
  customerId: string | null
  industry: string | null | undefined
  className?: string
}) {
  const profile = equipmentAwareProfile(industry)
  const [items, setItems] = useState<CustomerEquipment[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EquipmentFormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)

  const loadEquipment = useCallback((id: string) => {
    setEditing(false)
    setForm(EMPTY_FORM)
    setLoading(true)
    return fetch(`/api/crm/customers/${encodeURIComponent(id)}/equipment`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { equipment?: CustomerEquipment[] } } | null) => {
        setItems(json?.data?.equipment ?? [])
      })
      .catch(() => {
        setItems([])
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!customerId || !profile) {
      // Reset when the matched caller / their equipment-aware trade goes away — same
      // early-return-reset shape as crm-workspace-view.tsx's profile-load effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([])
      setEditing(false)
      setForm(EMPTY_FORM)
      return
    }
    void loadEquipment(customerId)
    // profile is derived from industry (stable per account) — no need to re-key on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, profile?.kind, loadEquipment])

  if (!profile || !customerId) return null

  const existing = items[0] ?? null

  const startEdit = () => {
    setForm(
      existing
        ? {
            brand: existing.brand,
            model: existing.model,
            install_year: existing.install_year,
            notes: existing.notes,
          }
        : EMPTY_FORM
    )
    setEditing(true)
  }

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/crm/customers/${encodeURIComponent(customerId)}/equipment`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, kind: profile.kind }),
      })
      const json = (await res.json().catch(() => null)) as {
        data?: { equipment?: CustomerEquipment }
      } | null
      if (res.ok && json?.data?.equipment) {
        setItems([json.data.equipment])
        setEditing(false)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card/40 px-3 py-3",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {profile.label} on file
        </p>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 text-2xs font-medium text-primary hover:underline"
          >
            {existing ? (
              <>
                <Pencil className="h-3 w-3" /> Update
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" /> Add
              </>
            )}
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              ["brand", "Brand"],
              ["model", "Model"],
              ["install_year", "Install year"],
              ["notes", "Notes"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-2xs text-muted-foreground">
              {label}
              <Input
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                className="mt-1 h-8 border-border bg-background text-sm"
              />
            </label>
          ))}
          <div className="col-span-2 flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : loading ? (
        <p className="mt-1 text-2xs text-muted-foreground">Checking…</p>
      ) : existing ? (
        <div className="mt-1 flex items-start gap-2">
          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          <p className="text-sm text-foreground">
            {[existing.brand, existing.model].filter(Boolean).join(" ") || profile.label}
            {existing.install_year ? (
              <span className="text-muted-foreground"> · installed {existing.install_year}</span>
            ) : null}
            {existing.notes ? <span className="block text-2xs text-muted-foreground">{existing.notes}</span> : null}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-2xs text-muted-foreground">Nothing on file yet.</p>
      )}
    </div>
  )
}
