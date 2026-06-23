"use client"

import { Suspense, use, useCallback, useLayoutEffect, useRef } from "react"
import { OrganizationSwitcher, OrganizationSwitcherPlaceholder } from "@/components/organization-switcher"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import type { Organization } from "@/lib/types"

function headerSeedOrganization(name: string): Organization {
  return {
    id: "__header-seed__",
    owner_user_id: "",
    name,
    is_default: true,
    created_at: new Date(0).toISOString(),
  }
}

/** Org switcher from a known org list — no Suspense, no fetch on first paint. */
function HeaderOrganizationsFromData({
  organizations,
  sessionBusinessName,
}: {
  organizations: Organization[]
  sessionBusinessName?: string
}) {
  const { organizations: workspaceOrgs, setOrganizations, setActiveOrganizationId } = useDashboardWorkspace()
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
  const { setOrganizations, setActiveOrganizationId } = useDashboardWorkspace()
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
  const { setOrganizations, setActiveOrganizationId } = useDashboardWorkspace()
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
      skipInitialFetch
      onOrganizationsLoaded={setOrganizations}
      onOrganizationChange={handleOrganizationChange}
    />
  )
}

/** Fallback when orgs are already in workspace (client tab navigation). */
function HeaderOrganizationsFromWorkspace({ sessionBusinessName }: { sessionBusinessName?: string }) {
  const { organizations, setActiveOrganizationId, setOrganizations } = useDashboardWorkspace()

  const handleOrganizationChange = useCallback(
    (id: string | null) => {
      setActiveOrganizationId(id)
    },
    [setActiveOrganizationId]
  )

  const placeholderLabel = sessionBusinessName?.trim() || organizations[0]?.name || "Business"

  if (organizations.length === 0) {
    return <OrganizationSwitcherPlaceholder label={placeholderLabel} />
  }

  return (
    <OrganizationSwitcher
      seedOrganizations={organizations}
      skipInitialFetch
      onOrganizationsLoaded={setOrganizations}
      onOrganizationChange={handleOrganizationChange}
    />
  )
}

/** Business workspace switcher mounted in the dashboard app header. */
export function DashboardHeaderWorkspace({ sessionBusinessName }: { sessionBusinessName?: string }) {
  const bootstrap = useDashboardBootstrapEffective()
  const { dashboardMainBootstrapPromise, organizationsPromise } = useDashboardStream()
  const placeholderLabel = sessionBusinessName?.trim() || "Business"

  if (bootstrap?.organizations.length) {
    return (
      <HeaderOrganizationsFromData
        organizations={bootstrap.organizations}
        sessionBusinessName={sessionBusinessName}
      />
    )
  }

  if (dashboardMainBootstrapPromise) {
    return <OrganizationSwitcherPlaceholder label={placeholderLabel} />
  }

  if (organizationsPromise) {
    return (
      <Suspense fallback={<OrganizationSwitcherPlaceholder label={placeholderLabel} />}>
        <HeaderOrganizationsFromStream
          organizationsPromise={organizationsPromise}
          sessionBusinessName={sessionBusinessName}
        />
      </Suspense>
    )
  }

  return <HeaderOrganizationsFromWorkspace sessionBusinessName={sessionBusinessName} />
}

export { DashboardOrganizationsBootstrap } from "@/components/dashboard-organizations-bootstrap"
