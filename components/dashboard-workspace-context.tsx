"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import type { PageId } from "@/components/app-shell"
import { useDashboardActivePage } from "@/components/dashboard-shell-chrome-context"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
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
}

const DashboardWorkspaceContext = createContext<DashboardWorkspaceContextValue | null>(null)

export function DashboardWorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const activeTab = useDashboardActivePage()
  const [activeLine, setActiveLine] = useState<string | null>(null)
  const [businessNumbers, setBusinessNumbers] = useState<DashboardBusinessNumber[]>([])
  const [businessNumbersLoading, setBusinessNumbersLoading] = useState(true)
  const [activityLogs, setActivityLogs] = useState<UiCallRecord[]>([])
  const [selectedActivityLog, setSelectedActivityLog] = useState<UiCallRecord | null>(null)
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])

  const setActiveOrganizationId = useCallback((id: string | null) => {
    setActiveOrganizationIdState(id)
    writeActiveOrganizationId(id)
    // Clear lines immediately so the previous business's numbers do not linger in the UI.
    setBusinessNumbers([])
    setActiveLine(null)
    setBusinessNumbersLoading(true)
  }, [])

  useEffect(() => {
    setActiveOrganizationIdState(readActiveOrganizationId())
    const onChanged = () => setActiveOrganizationIdState(readActiveOrganizationId())
    window.addEventListener("lyncr-organization-changed", onChanged)
    return () => window.removeEventListener("lyncr-organization-changed", onChanged)
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
