"use client"

import { useCallback, useEffect, useState } from "react"
import { Building2, ChevronDown, Loader2, Plus } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Props = {
  className?: string
  onOrganizationChange?: (organizationId: string | null) => void
  onOrganizationsLoaded?: (organizations: Organization[]) => void
}

export function OrganizationSwitcher({ className, onOrganizationChange, onOrganizationsLoaded }: Props) {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/organizations", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j: { data?: { organizations?: Organization[] } }) => {
        const rows = Array.isArray(j.data?.organizations) ? j.data!.organizations! : []
        setOrganizations(rows)
        onOrganizationsLoaded?.(rows)
        const stored = readActiveOrganizationId()
        const pick =
          (stored && rows.some((o) => o.id === stored) ? stored : null) ??
          rows.find((o) => o.is_default)?.id ??
          rows[0]?.id ??
          null
        setActiveId(pick)
        if (pick) writeActiveOrganizationId(pick)
        onOrganizationChange?.(pick)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [onOrganizationChange])

  useEffect(() => {
    load()
    const onChanged = () => {
      const id = readActiveOrganizationId()
      setActiveId(id)
      onOrganizationChange?.(id)
    }
    window.addEventListener("lyncr-organization-changed", onChanged)
    return () => window.removeEventListener("lyncr-organization-changed", onChanged)
  }, [load, onOrganizationChange])

  const active = organizations.find((o) => o.id === activeId) ?? organizations[0]

  function selectOrg(id: string) {
    setActiveId(id)
    writeActiveOrganizationId(id)
    onOrganizationChange?.(id)
  }

  async function addBusiness() {
    const name = window.prompt("New business name", "Key Squad 502")?.trim()
    if (!name || name.length < 2) return
    setCreating(true)
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || "Could not create business")
      const created = j.data?.organization as Organization | undefined
      if (created?.id) selectOrg(created.id)
      load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not create business")
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        <span className="hidden sm:inline">Loading…</span>
      </div>
    )
  }

  return (
    <DropdownMenu>
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
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch business</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            className={cn("cursor-pointer", org.id === activeId && "bg-primary/10 text-primary")}
            onSelect={() => selectOrg(org.id)}
          >
            <span className="truncate">{org.name}</span>
            {org.is_default ? (
              <span className="ml-auto text-[10px] text-muted-foreground">Default</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer gap-2 text-primary"
          disabled={creating}
          onSelect={(e) => {
            e.preventDefault()
            void addBusiness()
          }}
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add another business
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
