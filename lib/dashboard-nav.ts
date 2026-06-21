import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Inbox,
  Settings,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react"

/** All dashboard segments we recognize for highlighting and deep links. */
export type PageId =
  | "dashboard"
  | "activity"
  | "leads"
  | "customers"
  | "contacts"
  | "pay"
  | "settings"
  | "scheduler"
  | "help"

export type DashboardNavItem = {
  id: PageId
  label: string
  icon: LucideIcon
}

/** Primary command-dock destinations — Scheduler sits between Activity and Leads. */
export const dashboardNavItems: DashboardNavItem[] = [
  { id: "dashboard", label: "Routing", icon: Zap },
  { id: "activity", label: "Activity", icon: ClipboardList },
  { id: "scheduler", label: "Scheduler", icon: CalendarDays },
  { id: "leads", label: "Leads", icon: Inbox },
  { id: "contacts", label: "Team", icon: Users },
  { id: "pay", label: "Pay", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
]

/** Href for each tab — App Router Link targets for instant client navigation. */
export const DASHBOARD_PAGE_HREF: Record<PageId, string> = {
  dashboard: "/dashboard",
  activity: "/dashboard/activity",
  leads: "/dashboard/leads",
  customers: "/dashboard/customers",
  contacts: "/dashboard/contacts",
  pay: "/dashboard/pay",
  settings: "/dashboard/settings",
  scheduler: "/dashboard/scheduler",
  help: "/dashboard/help",
}
