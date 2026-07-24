"use client"

import { Suspense, use, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { OrganizationSwitcher, OrganizationSwitcherPlaceholder } from "@/components/organization-switcher"
import {
  useDashboardBootstrapEffective,
  useDashboardBootstrapSyncing,
} from "@/components/dashboard-bootstrap-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import type { Organization } from "@/lib/types"
import { organizationLabelFromBootstrap } from "@/lib/dashboard-bootstrap-seed"

function headerSeedOrganization(name: string): Organization {
  return {
    id: "__header-seed__",
    owner_user_id: "",
    name,
    is_default: true,
    created_at: new Date(0).toISOString(),
  }
}

/** Subtle header cue while stale bootstrap cache is revalidated in the background. */
function DashboardBootstrapSyncIndicator() {
  const isSyncing = useDashboardBootstrapSyncing()
  // Delay so a fast refresh does not flash the Syncing chip on every hard reload.
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isSyncing) {
      setShow(false)
      return
    }
    const timer = window.setTimeout(() => setShow(true), 400)
    return () => window.clearTimeout(timer)
  }, [isSyncing])

  if (!show) return null
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground/80"
      aria-live="polite"
      title="Refreshing dashboard data"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      <span className="hidden sm:inline">Syncing</span>
    </span>
  )
}

/** Org switcher from a known org list — no Suspense, no fetch on first paint. */
function HeaderOrganizationsFromData({
  organizations,
  sessionBusinessName,
}: {
  organizations: Organization[]
  sessionBusinessName?: string
}) {
  const {
    organizations: workspaceOrgs,
    setOrganizations,
    setActiveOrganizationId,
    activeOrganizationId,
  } = useDashboardWorkspace()
  const seededRef = useRef(false)

  const handleOrganizationChange = useCallback(
    (id: string | null) => {
      setActiveOrganizationId(id)
    },
    [setActiveOrganizationId]
  )

  useLayoutEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (
      workspaceOrgs.length === organizations.length &&
      organizations.every((org, i) => org.id === workspaceOrgs[i]?.id)
    ) {
      return
    }
    setOrganizations(organizations)
  }, [organizations, setOrganizations, workspaceOrgs])

  if (organizations.length === 0) {
    return (
      <OrganizationSwitcherPlaceholder
        label={sessionBusinessName?.trim() || "Business"}
      />
    )
  }

  return (
    <OrganizationSwitcher
      seedOrganizations={organizations}
      preferredActiveId={activeOrganizationId}
      skipInitialFetch
      onOrganizationsLoaded={setOrganizations}
      onOrganizationChange={handleOrganizationChange}
    />
  )
}

/** Header org switcher — shares the same bootstrap promise as the main stream gate for one flush. */
function HeaderOrganizationsFromMainBootstrap({
  bootstrapPromise,
  sessionBusinessName,
}: {
  bootstrapPromise: Promise<DashboardMainBootstrap>
  sessionBusinessName?: string
}) {
  const bootstrap = use(bootstrapPromise)
  const { setOrganizations, setActiveOrganizationId, activeOrganizationId } = useDashboardWorkspace()
  const seededRef = useRef(false)

  const handleOrganizationChange = useCallback(
    (id: string | null) => {
      setActiveOrganizationId(id)
    },
    [setActiveOrganizationId]
  )

  useLayoutEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    setOrganizations(bootstrap.organizations)
  }, [bootstrap.organizations, setOrganizations])

  if (bootstrap.organizations.length === 0) {
    return (
      <OrganizationSwitcherPlaceholder
        label={sessionBusinessName?.trim() || "Business"}
      />
    )
  }

  return (
    <OrganizationSwitcher
      seedOrganizations={bootstrap.organizations}
      preferredActiveId={activeOrganizationId}
      skipInitialFetch
      onOrganizationsLoaded={setOrganizations}
      onOrganizationChange={handleOrganizationChange}
    />
  )
}

/** Org list only — used on secondary dashboard routes that stream orgs without full bootstrap. */
function HeaderOrganizationsFromStream({
  organizationsPromise,
  sessionBusinessName,
}: {
  organizationsPromise: Promise<Organization[]>
  sessionBusinessName?: string
}) {
  const organizations = use(organizationsPromise)
  const { setOrganizations, setActiveOrganizationId, activeOrganizationId } = useDashboardWorkspace()
  const seededRef = useRef(false)

  const handleOrganizationChange = useCallback(
    (id: string | null) => {
      setActiveOrganizationId(id)
    },
    [setActiveOrganizationId]
  )

  useLayoutEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    setOrganizations(organizations)
  }, [organizations, setOrganizations])

  if (organizations.length === 0) {
    return (
      <OrganizationSwitcherPlaceholder
        label={sessionBusinessName?.trim() || "Business"}
      />
    )
  }

  return (
    <OrganizationSwitcher
      seedOrganizations={organizations}
      preferredActiveId={activeOrganizationId}
      skipInitialFetch
      onOrganizationsLoaded={setOrganizations}
      onOrganizationChange={handleOrganizationChange}
    />
  )
}

/** Fallback when orgs are already in workspace (client tab navigation). */
function HeaderOrganizationsFromWorkspace({ sessionBusinessName }: { sessionBusinessName?: string }) {
  const { organizations, setActiveOrganizationId, setOrganizations, activeOrganizationId } =
    useDashboardWorkspace()

  const handleOrganizationChange = useCallback(
    (id: string | null) => {
      setActiveOrganizationId(id)
    },
    [setActiveOrganizationId]
  )

  const placeholderLabel = organizationLabelFromBootstrap(
    organizations,
    activeOrganizationId,
    sessionBusinessName
  )

  if (organizations.length === 0) {
    return <OrganizationSwitcherPlaceholder label={placeholderLabel} />
  }

  return (
    <OrganizationSwitcher
      seedOrganizations={organizations}
      preferredActiveId={activeOrganizationId}
      skipInitialFetch
      onOrganizationsLoaded={setOrganizations}
      onOrganizationChange={handleOrganizationChange}
    />
  )
}

/** Business workspace switcher mounted in the dashboard app header. */
export function DashboardHeaderWorkspace({ sessionBusinessName }: { sessionBusinessName?: string }) {
  const bootstrap = useDashboardBootstrapEffective()
  const { activeOrganizationId } = useDashboardWorkspace()
  const { dashboardMainBootstrapPromise, organizationsPromise } = useDashboardStream()
  // Prefer the active org name so the chip does not flash account business_name → org name.
  const placeholderLabel = bootstrap?.organizations.length
    ? organizationLabelFromBootstrap(
        bootstrap.organizations,
        activeOrganizationId,
        sessionBusinessName
      )
    : sessionBusinessName?.trim() || "Business"

  const switcher = bootstrap?.organizations.length ? (
    <HeaderOrganizationsFromData
      organizations={bootstrap.organizations}
      sessionBusinessName={sessionBusinessName}
    />
  ) : dashboardMainBootstrapPromise ? (
    <OrganizationSwitcherPlaceholder label={placeholderLabel} />
  ) : organizationsPromise ? (
    <Suspense fallback={<OrganizationSwitcherPlaceholder label={placeholderLabel} />}>
      <HeaderOrganizationsFromStream
        organizationsPromise={organizationsPromise}
        sessionBusinessName={sessionBusinessName}
      />
    </Suspense>
  ) : (
    <HeaderOrganizationsFromWorkspace sessionBusinessName={sessionBusinessName} />
  )

  return (
    <div className="flex w-full min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden">
      <div className="min-w-0 w-full max-w-full flex-1 sm:w-[min(100%,16rem)] sm:flex-none">
        {switcher}
      </div>
      <DashboardBootstrapSyncIndicator />
    </div>
  )
}

export { DashboardOrganizationsBootstrap } from "@/components/dashboard-organizations-bootstrap"
