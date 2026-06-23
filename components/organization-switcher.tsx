"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Building2, ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { Organization } from "@/lib/types"
import {
  readActiveOrganizationId,
  writeActiveOrganizationId,
} from "@/lib/workspace-organizations"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { showUpgradeSubscriptionModal } from "@/components/upgrade-subscription-modal"
import {
  MULTI_TENANT_UPGRADE_MESSAGE,
  MULTI_TENANT_UPGRADE_TITLE,
} from "@/lib/service-context"
import type { SubscriptionTier } from "@/lib/subscription-tier"

type Props = {
  className?: string
  onOrganizationChange?: (organizationId: string | null) => void
  onOrganizationsLoaded?: (organizations: Organization[]) => void
  /** Preloaded rows from the server stream — skips the first client fetch. */
  seedOrganizations?: Organization[]
  /** When true, do not call GET /api/organizations on mount (stream already supplied rows). */
  skipInitialFetch?: boolean
  /** Account business name — used as a placeholder label while orgs load on client nav. */
  sessionBusinessName?: string
}

/** Static header chip shown while streamed organizations resolve (looks like the real switcher). */
export function OrganizationSwitcherPlaceholder({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled
      aria-busy="true"
      aria-label="Loading business workspace"
      className={cn(
        "h-9 max-w-[min(100%,14rem)] gap-1.5 border-border/70 bg-card/80 px-2.5 text-xs font-medium sm:max-w-[16rem] sm:px-3",
        className
      )}
    >
      <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="truncate">{label}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
    </Button>
  )
}

type ServiceContextPayload = {
  master_test_bypass?: boolean
  subscription_tier?: SubscriptionTier
  subscription_active?: boolean
  capabilities?: { multi_tenant_workspaces?: boolean }
}

/** True when the row is a real Neon workspace (not the pre-migration synthetic legacy id). */
function isEditableWorkspace(org: Organization): boolean {
  return !org.id.startsWith("legacy-")
}

export function OrganizationSwitcher({
  className,
  onOrganizationChange,
  onOrganizationsLoaded,
  seedOrganizations,
  skipInitialFetch = false,
  sessionBusinessName,
}: Props) {
  const [organizations, setOrganizations] = useState<Organization[]>(() => seedOrganizations ?? [])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !skipInitialFetch && (seedOrganizations?.length ?? 0) === 0)
  const [creating, setCreating] = useState(false)
  const [canAddWorkspace, setCanAddWorkspace] = useState(false)
  const [serviceTier, setServiceTier] = useState<SubscriptionTier>("starter")
  const [subscriptionActive, setSubscriptionActive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const [renameTarget, setRenameTarget] = useState<Organization | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const onOrganizationChangeRef = useRef(onOrganizationChange)
  const onOrganizationsLoadedRef = useRef(onOrganizationsLoaded)
  onOrganizationChangeRef.current = onOrganizationChange
  onOrganizationsLoadedRef.current = onOrganizationsLoaded

  const applyOrganizations = useCallback((rows: Organization[], preferredActiveId?: string | null) => {
    setOrganizations(rows)
    onOrganizationsLoadedRef.current?.(rows)
    const stored = preferredActiveId ?? readActiveOrganizationId()
    const pick =
      (stored && rows.some((o) => o.id === stored) ? stored : null) ??
      rows.find((o) => o.is_default)?.id ??
      rows[0]?.id ??
      null
    setActiveId((prev) => {
      if (pick !== prev) {
        onOrganizationChangeRef.current?.(pick)
        return pick
      }
      return prev
    })
    if (pick) writeActiveOrganizationId(pick)
  }, [])

  const loadServiceContext = useCallback(() => {
    fetch("/api/service-context", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: ServiceContextPayload }) => {
        const data = j?.data
        if (!data) return
        setCanAddWorkspace(data.capabilities?.multi_tenant_workspaces === true)
        if (data.subscription_tier) setServiceTier(data.subscription_tier)
        setSubscriptionActive(data.subscription_active === true)
      })
      .catch(() => {})
  }, [])

  const load = useCallback(
    (opts?: { silent?: boolean; preferredActiveId?: string | null }) => {
      if (!opts?.silent) setLoading(true)
      fetch("/api/organizations", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
        .then((j: { data?: { organizations?: Organization[] } }) => {
          const rows = Array.isArray(j.data?.organizations) ? j.data!.organizations! : []
          applyOrganizations(rows, opts?.preferredActiveId)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    },
    [applyOrganizations]
  )

  useEffect(() => {
    if (skipInitialFetch) return
    load()
    loadServiceContext()
    const onChanged = () => {
      const id = readActiveOrganizationId()
      setActiveId(id)
      onOrganizationChangeRef.current?.(id)
    }
    window.addEventListener("lyncr-organization-changed", onChanged)
    return () => window.removeEventListener("lyncr-organization-changed", onChanged)
  }, [load, loadServiceContext, skipInitialFetch])

  useEffect(() => {
    if (!skipInitialFetch) return
    loadServiceContext()
  }, [loadServiceContext, skipInitialFetch])

  useEffect(() => {
    if (!seedOrganizations?.length) return
    applyOrganizations(seedOrganizations)
  }, [applyOrganizations, seedOrganizations])

  const active = organizations.find((o) => o.id === activeId) ?? organizations[0]
  const realWorkspaceCount = organizations.filter(isEditableWorkspace).length
  const canDeleteWorkspace = realWorkspaceCount > 1

  function selectOrg(id: string) {
    if (id === activeId) return
    setActiveId(id)
    writeActiveOrganizationId(id)
    onOrganizationChangeRef.current?.(id)
    setMenuOpen(false)
  }

  function openRename(org: Organization) {
    setRenameTarget(org)
    setRenameDraft(org.name)
  }

  async function submitRename() {
    if (!renameTarget) return
    const name = renameDraft.trim()
    if (name.length < 2) {
      toast.error("Enter at least 2 characters")
      return
    }
    setRenameSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(renameTarget.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Could not rename business")
      toast.success("Business renamed")
      setRenameTarget(null)
      const rows = Array.isArray(j.data?.organizations) ? j.data.organizations : null
      if (rows) applyOrganizations(rows)
      else load({ silent: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename business")
    } finally {
      setRenameSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        credentials: "include",
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Could not delete business")

      const fallbackId = String(j.data?.fallback_organization_id ?? "")
      const wasActive = deleteTarget.id === activeId

      toast.success(`Deleted ${deleteTarget.name}`)
      setDeleteTarget(null)
      setMenuOpen(false)

      if (wasActive && fallbackId) {
        setActiveId(fallbackId)
        writeActiveOrganizationId(fallbackId)
        onOrganizationChangeRef.current?.(fallbackId)
      }

      const rows = Array.isArray(j.data?.organizations) ? j.data.organizations : null
      if (rows) applyOrganizations(rows, wasActive ? fallbackId : activeId)
      else load({ silent: true, preferredActiveId: wasActive ? fallbackId : activeId })

      window.dispatchEvent(new CustomEvent("zing-business-numbers-changed"))
      window.dispatchEvent(new CustomEvent("lyncr-workspace-data-changed"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete business")
    } finally {
      setDeleteBusy(false)
    }
  }

  function promptAddWorkspace() {
    if (!canAddWorkspace) {
      showUpgradeSubscriptionModal({
        title: MULTI_TENANT_UPGRADE_TITLE,
        message: MULTI_TENANT_UPGRADE_MESSAGE,
        currentTier: serviceTier,
        suggestedTier: "business",
        subscriptionActive,
      })
      return
    }
    const name = window.prompt("New business name", "Key Squad 502")?.trim()
    if (!name || name.length < 2) return
    void submitNewWorkspace(name)
  }

  async function submitNewWorkspace(name: string) {
    setCreating(true)
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 403 && j.upgrade_required) {
        showUpgradeSubscriptionModal({
          title: MULTI_TENANT_UPGRADE_TITLE,
          message: j.error || MULTI_TENANT_UPGRADE_MESSAGE,
          currentTier: serviceTier,
          suggestedTier: "business",
          subscriptionActive,
        })
        return
      }
      if (!res.ok) throw new Error(j.error || "Could not create business")
      const created = j.data?.organization as Organization | undefined
      if (created?.id) selectOrg(created.id)
      load({ silent: true, preferredActiveId: created?.id ?? activeId })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create business")
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <OrganizationSwitcherPlaceholder
        label={sessionBusinessName?.trim() || "Business"}
        className={className}
      />
    )
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-9 max-w-[min(100%,14rem)] gap-1.5 border-border/70 bg-card/80 px-2.5 text-xs font-medium sm:max-w-[16rem] sm:px-3",
              className
            )}
          >
            <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{active?.name ?? "Business"}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 p-1">
          <DropdownMenuLabel className="px-2 text-xs text-muted-foreground">Switch business</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {organizations.map((org) => {
            const selected = org.id === activeId
            const editable = isEditableWorkspace(org)
            return (
              <div
                key={org.id}
                className={cn(
                  "group flex items-center gap-1 rounded-sm px-1 py-0.5",
                  selected && "bg-primary/10"
                )}
              >
                <button
                  type="button"
                  onClick={() => selectOrg(org.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                    "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/40",
                    selected ? "text-primary" : "text-foreground"
                  )}
                >
                  <span className="truncate font-medium">{org.name}</span>
                  {org.is_default ? (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">Default</span>
                  ) : null}
                </button>
                {editable ? (
                  <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      aria-label={`Rename ${org.name}`}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        openRename(org)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${org.name}`}
                      disabled={!canDeleteWorkspace}
                      className={cn(
                        "rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500",
                        !canDeleteWorkspace && "cursor-not-allowed opacity-40"
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!canDeleteWorkspace) {
                          toast.error("You must keep at least one business workspace")
                          return
                        }
                        setDeleteTarget(org)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-primary"
            disabled={creating}
            onSelect={(e) => {
              e.preventDefault()
              promptAddWorkspace()
            }}
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add new business location / workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={renameTarget != null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename business</DialogTitle>
            <DialogDescription>Update how this workspace appears in your dashboard.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="workspace-rename">Business name</Label>
            <Input
              id="workspace-rename"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitRename()
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)} disabled={renameSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitRename()} disabled={renameSaving}>
              {renameSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteTarget?.name}? This will release associated lines and delete
              local routing rules.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
            >
              {deleteBusy ? "Deleting…" : "Delete workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
