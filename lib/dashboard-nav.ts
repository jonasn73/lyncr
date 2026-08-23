import {
  Activity,
  BarChart3,
  CalendarDays,
  ClipboardList,
  ContactRound,
  Map,
  MessageSquare,
  Settings,
  Zap,
  type LucideIcon,
} from "lucide-react"

/** All dashboard segments we recognize for highlighting and deep links. */
export type PageId =
  | "dashboard"
  | "activity"
  | "messages"
  | "leads"
  | "customers"
  | "contacts"
  | "pay"
  | "settings"
  | "scheduler"
  | "inventory"
  | "team"
  | "help"

export type DashboardNavItem = {
  id: PageId
  label: string
  icon: LucideIcon
}

/**
 * Primary command-dock, ordered by the path a call actually travels:
 * it rings (Lines) -> you see it (Activity) -> you reply (Messages) -> you book it
 * (Scheduler) -> you drive to it (Map) -> it settles into a record (CRM) -> account.
 * Lines stays first and Settings stays last.
 */
export const dashboardNavItems: DashboardNavItem[] = [
  { id: "dashboard", label: "Lines", icon: Zap },
  { id: "activity", label: "Activity", icon: ClipboardList },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "scheduler", label: "Scheduler", icon: CalendarDays },
  { id: "contacts", label: "Map", icon: Map },
  { id: "customers", label: "CRM", icon: ContactRound },
  { id: "pay", label: "Lyncr bill", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
]

/**
 * Mobile bottom bar — same relative order as the rail so muscle memory carries over.
 * Scheduler stays desktop-only (command dock / deep links); Messages is here because an
 * unanswered text costs money faster than anything else a phone user can reach.
 */
export const mobileBottomNavItems: DashboardNavItem[] = [
  { id: "dashboard", label: "Lines", icon: Zap },
  { id: "activity", label: "Activity", icon: ClipboardList },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "contacts", label: "Map", icon: Map },
  { id: "customers", label: "CRM", icon: ContactRound },
]

/** Href for each tab — App Router Link targets for instant client navigation. */
export const DASHBOARD_PAGE_HREF: Record<PageId, string> = {
  dashboard: "/dashboard",
  activity: "/dashboard/activity",
  messages: "/dashboard/messages",
  /** Legacy Leads URL opens the CRM hub (lead stages live there). */
  leads: "/dashboard/customers?tab=leads",
  customers: "/dashboard/customers",
  contacts: "/dashboard/contacts",
  pay: "/dashboard/pay",
  settings: "/dashboard/settings",
  scheduler: "/dashboard/scheduler",
  inventory: "/dashboard/inventory",
  team: "/dashboard/team",
  help: "/dashboard/help",
}

/** Mobile Activities tab opens the full activity hub (not missed-only deep link). */
export const DASHBOARD_MOBILE_PAGE_HREF: Partial<Record<PageId, string>> = {
  activity: "/dashboard/activity?filter=all",
}
