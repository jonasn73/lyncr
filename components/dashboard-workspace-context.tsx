"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import type { PageId } from "@/components/app-shell"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import {
  businessNumbersMatch,
  type DashboardBusinessNumber,
} from "@/lib/dashboard-routing-utils"
import type { BusinessNumbersQueryResult } from "@/lib/hooks/use-business-numbers-query"
import { persistedCacheKey, readPersistedCache } from "@/lib/swr/persisted-cache"
import type { DashboardMainBootstrap } from "@/lib/dashboard-stream-types"
import {
  workspaceSeedFromBootstrap,
} from "@/lib/dashboard-bootstrap-seed"
import { readDashboardBootstrapCache } from "@/lib/dashboard-bootstrap-cache"
import type { UiCallRecord } from "@/lib/hooks/use-operations-data"
import type { Organization } from "@/lib/types"
import {
  ensureActiveOrganizationCookie,
  readActiveOrganizationId,
  writeActiveOrganizationId,
} from "@/lib/workspace-organizations"
import type { DashboardPaintSeeds } from "@/lib/dashboard-paint-seeds-types"
import {
  linesChromeToBusinessNumbers,
  readLinesChromeCache,
  writeLinesChromeCache,
} from "@/lib/lines-chrome-cache"
import { writeWorkspaceLabelCache } from "@/lib/workspace-label-cache"

const PAGE_HREF: Record<PageId, string> = {
  dashboard: "/dashboard",
  activity: "/dashboard/activity",
  messages: "/dashboard/messages",
  scheduler: "/dashboard/scheduler",
  // Soft-nav to CRM Leads tab (matches DASHBOARD_PAGE_HREF.leads).
  leads: "/dashboard/customers?tab=leads",
  customers: "/dashboard/customers",
  contacts: "/dashboard/contacts",
  pay: "/dashboard/pay",
  settings: "/dashboard/settings",
  inventory: "/dashboard/inventory",
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
  initialActiveOrganizationId = null,
  paintSeeds = null,
}: {
  children: ReactNode
  initialBootstrap?: DashboardMainBootstrap | null
  /** Cookie-backed org id from the server so SSR matches the client switcher. */
  initialActiveOrganizationId?: string | null
  /** SSR paint cookies — seed Main Line / org name before sessionStorage hydrates. */
  paintSeeds?: DashboardPaintSeeds | null
}) {
  const bootstrapSeed = resolveWorkspaceBootstrapSeed(initialBootstrap)
  const workspaceSeed = bootstrapSeed
    ? workspaceSeedFromBootstrap(bootstrapSeed, initialActiveOrganizationId)
    : null
  // Cookie chrome when bootstrap session cache is invisible to SSR.
  const linesPaint = readLinesChromeCache(paintSeeds?.lines ?? null)

  const router = useRouter()
  const activeTab = useDashboardActivePage()
  const [activeLine, setActiveLine] = useState<string | null>(() => {
    if (workspaceSeed?.activeLine) return workspaceSeed.activeLine
    return linesPaint?.activeLine ?? null
  })
  const [businessNumbers, setBusinessNumbers] = useState<DashboardBusinessNumber[]>(() => {
    if (workspaceSeed?.phoneLines.length) return workspaceSeed.phoneLines
    if (linesPaint?.lines.length) return linesChromeToBusinessNumbers(linesPaint)
    const orgHint = initialActiveOrganizationId ?? readActiveOrganizationId()
    const cached = readCachedBusinessNumbers(orgHint)
    return cached?.numbers ?? []
  })
  const [businessNumbersLoading, setBusinessNumbersLoading] = useState(() => {
    if (workspaceSeed) return false
    if (linesPaint?.lines.length) return false
    const orgHint = initialActiveOrganizationId ?? readActiveOrganizationId()
    return readCachedBusinessNumbers(orgHint) === undefined
  })
  const [activityLogs, setActivityLogs] = useState<UiCallRecord[]>([])
  const [selectedActivityLog, setSelectedActivityLog] = useState<UiCallRecord | null>(null)
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(() => {
    if (workspaceSeed?.activeOrganizationId) return workspaceSeed.activeOrganizationId
    // Cookie from layout — keep SSR org id aligned with session cache keys (telemetry / Latest).
    if (initialActiveOrganizationId) return initialActiveOrganizationId
    if (linesPaint?.organizationId) return linesPaint.organizationId
    if (paintSeeds?.workspace?.organizationId) return paintSeeds.workspace.organizationId
    if (typeof window === "undefined") return null
    return readActiveOrganizationId()
  })
  const [organizations, setOrganizations] = useState<Organization[]>(() => {
    if (workspaceSeed?.organizations.length) return workspaceSeed.organizations
    // Minimal org row so the header chip can paint the business name on SSR.
    const label = paintSeeds?.workspace
    if (label?.name?.trim()) {
      return [
        {
          id: label.organizationId || "__paint-seed__",
          owner_user_id: "",
          name: label.name.trim(),
          is_default: true,
          created_at: new Date(0).toISOString(),
        },
      ]
    }
    return []
  })
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

      // Mirror into paint cookies so the next hard refresh SSR can paint name + Main Line.
      const activeOrg =
        payload.organizations.find((o) => o.id === payload.activeOrganizationId) ??
        payload.organizations[0]
      if (activeOrg?.name?.trim()) {
        writeWorkspaceLabelCache({
          organizationId: activeOrg.id,
          name: activeOrg.name,
        })
      }
      if (payload.phoneLines.length > 0) {
        writeLinesChromeCache({
          organizationId: payload.activeOrganizationId,
          activeLine: payload.activeLine,
          lines: payload.phoneLines,
        })
      }
    },
    []
  )

  // Mirror localStorage → cookie so the next hard refresh SSR picks the same org name.
  useEffect(() => {
    ensureActiveOrganizationCookie()
  }, [])

  // Keep paint cookies warm when workspace state changes outside bootstrap hydrate.
  useEffect(() => {
    const active =
      organizations.find((o) => o.id === activeOrganizationId) ?? organizations[0]
    if (!active?.name?.trim() || active.id.startsWith("__")) return
    writeWorkspaceLabelCache({ organizationId: active.id, name: active.name })
  }, [organizations, activeOrganizationId])

  useEffect(() => {
    if (businessNumbers.length === 0) return
    writeLinesChromeCache({
      organizationId: activeOrganizationId,
      activeLine,
      lines: businessNumbers,
    })
  }, [businessNumbers, activeLine, activeOrganizationId])

  // SSR cannot read sessionStorage — re-apply bootstrap/numbers cache before paint so
  // Live & Connected / line picker do not flash pulse bars ("....") then real status.
  useLayoutEffect(() => {
    if (workspaceSeed) return
    const orgId = readActiveOrganizationId()
    const boot = readDashboardBootstrapCache()
    if (boot) {
      const seed = workspaceSeedFromBootstrap(boot, orgId)
      hydrateWorkspaceFromBootstrap(seed)
      return
    }
    const cached = readCachedBusinessNumbers(orgId)
    if (!cached?.numbers?.length) return
    setBusinessNumbers(cached.numbers)
    setBusinessNumbersLoading(false)
    if (orgId) setActiveOrganizationIdState(orgId)
  }, [workspaceSeed, hydrateWorkspaceFromBootstrap])

  useEffect(() => {
    if (workspaceSeed) return
    setActiveOrganizationIdState(readActiveOrganizationId())
    const onChanged = () => setActiveOrganizationIdState(readActiveOrganizationId())
    window.addEventListener("lyncr-organization-changed", onChanged)
    return () => window.removeEventListener("lyncr-organization-changed", onChanged)
  }, [workspaceSeed])

  // Bail out when digits match — E.164 vs raw "555…" must not flip-flop (#185).
  const setActiveLineStable = useCallback((line: string | null) => {
    setActiveLine((prev) => {
      if (prev === line) return prev
      if (prev && line && businessNumbersMatch(prev, line)) return prev
      return line
    })
  }, [])

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
      setActiveLine: setActiveLineStable,
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
      setActiveLineStable,
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
