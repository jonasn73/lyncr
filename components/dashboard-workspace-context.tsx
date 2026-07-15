"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import type { PageId } from "@/components/app-shell"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import type { BusinessNumbersQueryResult } from "@/lib/hooks/use-business-numbers-query"
import { persistedCacheKey, readPersistedCache } from "@/lib/swr/persisted-cache"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import {
  workspaceSeedFromBootstrap,
} from "@/lib/dashboard-bootstrap-seed"
import { readDashboardBootstrapCache } from "@/lib/dashboard-bootstrap-cache"
import type { UiCallRecord } from "@/lib/hooks/use-operations-data"
import type { Organization } from "@/lib/types"
import { readActiveOrganizationId, writeActiveOrganizationId } from "@/lib/workspace-organizations"

const PAGE_HREF: Record<PageId, string> = {
  dashboard: "/dashboard",
  activity: "/dashboard/activity",
  scheduler: "/dashboard/scheduler",
  leads: "/dashboard/leads",
  customers: "/dashboard/customers",
  contacts: "/dashboard/contacts",
  pay: "/dashboard/pay",
  settings: "/dashboard/settings",
  help: "/dashboard/help",
}

type DashboardWorkspaceContextValue = {
  /** Bottom-nav / presence host segment (from URL). */
  activeTab: PageId
  setActiveTab: (tab: PageId) => void
  /** E.164 business line selected in the call-flow picker. */
  activeLine: string | null
  setActiveLine: (line: string | null) => void
  businessNumbers: DashboardBusinessNumber[]
  setBusinessNumbers: (numbers: DashboardBusinessNumber[]) => void
  /** True until GET /api/numbers/mine resolves (empty or full). Prevents empty-state flash on refresh. */
  businessNumbersLoading: boolean
  setBusinessNumbersLoading: (loading: boolean) => void
  activityLogs: UiCallRecord[]
  setActivityLogs: (logs: UiCallRecord[]) => void
  selectedActivityLog: UiCallRecord | null
  setSelectedActivityLog: (log: UiCallRecord | null) => void
  openActivityLog: (log: UiCallRecord) => void
  closeActivityLog: () => void
  /** Active business workspace (`065` organizations). */
  activeOrganizationId: string | null
  setActiveOrganizationId: (id: string | null) => void
  organizations: Organization[]
  setOrganizations: (orgs: Organization[]) => void
  /** One-shot server bootstrap — avoids setActiveOrganizationId side effects that clear the active line. */
  hydrateWorkspaceFromBootstrap: (payload: {
    organizations: Organization[]
    phoneLines: DashboardBusinessNumber[]
    activeOrganizationId: string | null
    activeLine: string | null
  }) => void
}

const DashboardWorkspaceContext = createContext<DashboardWorkspaceContextValue | null>(null)

function readCachedBusinessNumbers(orgId: string | null): BusinessNumbersQueryResult | undefined {
  if (typeof window === "undefined") return undefined
  const key = persistedCacheKey("business-numbers", orgId ?? "default")
  return readPersistedCache<BusinessNumbersQueryResult>(key)
}

function resolveWorkspaceBootstrapSeed(
  initialBootstrap?: DashboardMainBootstrap | null
): DashboardMainBootstrap | undefined {
  if (initialBootstrap) return initialBootstrap
  if (typeof window === "undefined") return undefined
  return readDashboardBootstrapCache()
}

export function DashboardWorkspaceProvider({
  children,
  initialBootstrap,
}: {
  children: ReactNode
  initialBootstrap?: DashboardMainBootstrap | null
}) {
  const bootstrapSeed = resolveWorkspaceBootstrapSeed(initialBootstrap)
  const workspaceSeed = bootstrapSeed ? workspaceSeedFromBootstrap(bootstrapSeed) : null

  const router = useRouter()
  const activeTab = useDashboardActivePage()
  const [activeLine, setActiveLine] = useState<string | null>(() => workspaceSeed?.activeLine ?? null)
  const [businessNumbers, setBusinessNumbers] = useState<DashboardBusinessNumber[]>(() => {
    if (workspaceSeed?.phoneLines.length) return workspaceSeed.phoneLines
    const cached = readCachedBusinessNumbers(readActiveOrganizationId())
    return cached?.numbers ?? []
  })
  const [businessNumbersLoading, setBusinessNumbersLoading] = useState(() => {
    if (workspaceSeed) return false
    return readCachedBusinessNumbers(readActiveOrganizationId()) === undefined
  })
  const [activityLogs, setActivityLogs] = useState<UiCallRecord[]>([])
  const [selectedActivityLog, setSelectedActivityLog] = useState<UiCallRecord | null>(null)
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(() => {
    if (workspaceSeed?.activeOrganizationId) return workspaceSeed.activeOrganizationId
    if (typeof window === "undefined") return null
    return readActiveOrganizationId()
  })
  const [organizations, setOrganizations] = useState<Organization[]>(
    () => workspaceSeed?.organizations ?? []
  )
  const activeOrganizationIdRef = useRef(activeOrganizationId)
  activeOrganizationIdRef.current = activeOrganizationId

  const setActiveOrganizationId = useCallback((id: string | null) => {
    if (activeOrganizationIdRef.current === id) return
    writeActiveOrganizationId(id)
    const cached = readCachedBusinessNumbers(id)
    setBusinessNumbers(cached?.numbers ?? [])
    setActiveLine(null)
    setBusinessNumbersLoading(cached === undefined)
    setActiveOrganizationIdState(id)
  }, [])

  const hydrateWorkspaceFromBootstrap = useCallback(
    (payload: {
      organizations: Organization[]
      phoneLines: DashboardBusinessNumber[]
      activeOrganizationId: string | null
      activeLine: string | null
    }) => {
      // Skip no-op hydrates so a background refresh with the same data does not blink the UI.
      setOrganizations((prev) => {
        if (
          prev.length === payload.organizations.length &&
          prev.every(
            (org, i) =>
              org.id === payload.organizations[i]?.id &&
              org.name === payload.organizations[i]?.name
          )
        ) {
          return prev
        }
        return payload.organizations
      })
      setBusinessNumbers((prev) => {
        if (
          prev.length === payload.phoneLines.length &&
          prev.every(
            (line, i) =>
              line.number === payload.phoneLines[i]?.number &&
              line.status === payload.phoneLines[i]?.status &&
              line.organization_id === payload.phoneLines[i]?.organization_id
          )
        ) {
          return prev
        }
        return payload.phoneLines
      })
      setBusinessNumbersLoading(false)
      setActiveOrganizationIdState((prev) =>
        prev === payload.activeOrganizationId ? prev : payload.activeOrganizationId
      )
      if (payload.activeOrganizationId) writeActiveOrganizationId(payload.activeOrganizationId)
      setActiveLine((prev) => (prev === payload.activeLine ? prev : payload.activeLine))
    },
    []
  )

  useEffect(() => {
    if (workspaceSeed) return
    setActiveOrganizationIdState(readActiveOrganizationId())
    const onChanged = () => setActiveOrganizationIdState(readActiveOrganizationId())
    window.addEventListener("lyncr-organization-changed", onChanged)
    return () => window.removeEventListener("lyncr-organization-changed", onChanged)
  }, [workspaceSeed])

  const setActiveTab = useCallback(
    (tab: PageId) => {
      router.push(PAGE_HREF[tab])
    },
    [router]
  )

  const openActivityLog = useCallback((log: UiCallRecord) => {
    setSelectedActivityLog(log)
  }, [])

  const closeActivityLog = useCallback(() => {
    setSelectedActivityLog(null)
  }, [])

  const value = useMemo(
    () => ({
      activeTab,
      setActiveTab,
      activeLine,
      setActiveLine,
      businessNumbers,
      setBusinessNumbers,
      businessNumbersLoading,
      setBusinessNumbersLoading,
      activityLogs,
      setActivityLogs,
      selectedActivityLog,
      setSelectedActivityLog,
      openActivityLog,
      closeActivityLog,
      activeOrganizationId,
      setActiveOrganizationId,
      organizations,
      setOrganizations,
      hydrateWorkspaceFromBootstrap,
    }),
    [
      activeTab,
      setActiveTab,
      activeLine,
      businessNumbers,
      businessNumbersLoading,
      activityLogs,
      selectedActivityLog,
      openActivityLog,
      closeActivityLog,
      activeOrganizationId,
      setActiveOrganizationId,
      organizations,
      hydrateWorkspaceFromBootstrap,
    ]
  )

  return <DashboardWorkspaceContext.Provider value={value}>{children}</DashboardWorkspaceContext.Provider>
}

export function useDashboardWorkspace(): DashboardWorkspaceContextValue {
  const ctx = useContext(DashboardWorkspaceContext)
  if (!ctx) {
    throw new Error("useDashboardWorkspace must be used within DashboardWorkspaceProvider")
  }
  return ctx
}
