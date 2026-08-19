"use client"

import { Suspense, use, useCallback, useLayoutEffect } from "react"
import { OrganizationSwitcher, OrganizationSwitcherPlaceholder } from "@/components/organization-switcher"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import type { Organization } from "@/lib/types"
import { organizationLabelFromBootstrap } from "@/lib/dashboard-bootstrap-seed"
import { useDashboardPaintSeeds } from "@/lib/dashboard-paint-seeds"

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

  const handleOrganizationChange = useCallback(
    (id: string | null) => {
      setActiveOrganizationId(id)
    },
    [setActiveOrganizationId]
  )

  useLayoutEffect(() => {
    // Replace a one-row paint seed when the real workspace list arrives.
    if (
      workspaceOrgs.length === organizations.length &&
      organizations.every((org, i) => org.id === workspaceOrgs[i]?.id && org.name === workspaceOrgs[i]?.name)
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

  const handleOrganizationChange = useCallback(
    (id: string | null) => {
      setActiveOrganizationId(id)
    },
    [setActiveOrganizationId]
  )

  useLayoutEffect(() => {
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

  const handleOrganizationChange = useCallback(
    (id: string | null) => {
      setActiveOrganizationId(id)
    },
    [setActiveOrganizationId]
  )

  useLayoutEffect(() => {
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
  const { activeOrganizationId, organizations } = useDashboardWorkspace()
  const { dashboardMainBootstrapPromise, organizationsPromise } = useDashboardStream()
  const paintSeeds = useDashboardPaintSeeds()
  // Cookie paint name only — sessionStorage here mismatched SSR (“Business” → “Key Squad 502”).
  const paintLabel = paintSeeds.workspace?.name?.trim() || ""
  const sessionLabel = sessionBusinessName?.trim() || ""
  const fallbackLabel = paintLabel || sessionLabel || "Business"

  // Prefer the active org name so the chip does not flash account business_name → org name.
  const placeholderLabel = bootstrap?.organizations.length
    ? organizationLabelFromBootstrap(
        bootstrap.organizations,
        activeOrganizationId,
        fallbackLabel
      )
    : organizations.length
      ? organizationLabelFromBootstrap(organizations, activeOrganizationId, fallbackLabel)
      : fallbackLabel

  const switcher = bootstrap?.organizations.length ? (
    <HeaderOrganizationsFromData
      organizations={bootstrap.organizations}
      sessionBusinessName={placeholderLabel}
    />
  ) : organizations.length > 0 ? (
    // Paint-seed / workspace orgs — real chip on SSR before bootstrap promise resolves.
    <HeaderOrganizationsFromData
      organizations={organizations}
      sessionBusinessName={placeholderLabel}
    />
  ) : dashboardMainBootstrapPromise ? (
    <OrganizationSwitcherPlaceholder label={placeholderLabel} />
  ) : organizationsPromise ? (
    <Suspense fallback={<OrganizationSwitcherPlaceholder label={placeholderLabel} />}>
      <HeaderOrganizationsFromStream
        organizationsPromise={organizationsPromise}
        sessionBusinessName={placeholderLabel}
      />
    </Suspense>
  ) : (
    <HeaderOrganizationsFromWorkspace sessionBusinessName={placeholderLabel} />
  )

  return (
    // Mobile: flush left (fills the L slot). sm+: centered under the header.
    <div className="flex w-full min-w-0 max-w-full items-center justify-start gap-1.5 overflow-hidden sm:justify-center">
      <div className="min-w-0 w-full max-w-full flex-1 sm:w-[min(100%,16rem)] sm:flex-none">
        {switcher}
      </div>
    </div>
  )
}

export { DashboardOrganizationsBootstrap } from "@/components/dashboard-organizations-bootstrap"
