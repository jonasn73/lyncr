import {
  Activity,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Inbox,
  Settings,
  Users,
  UsersRound,
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

/** Primary command-dock destinations — Scheduler directly under Routing; Activity below Scheduler. */
export const dashboardNavItems: DashboardNavItem[] = [
  { id: "dashboard", label: "Routing", icon: Zap },
  { id: "scheduler", label: "Scheduler", icon: CalendarDays },
  { id: "activity", label: "Activity", icon: ClipboardList },
  { id: "leads", label: "Leads", icon: Inbox },
  { id: "contacts", label: "Team", icon: Users },
  { id: "pay", label: "Pay", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
]

/** Mobile bottom bar — four primary destinations so icons are not squished on narrow screens. */
export const mobileBottomNavItems: DashboardNavItem[] = [
  { id: "dashboard", label: "Lines", icon: Zap },
  { id: "scheduler", label: "Scheduler", icon: CalendarDays },
  { id: "activity", label: "Activities", icon: Activity },
  { id: "contacts", label: "Team", icon: UsersRound },
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

/** Mobile Activities tab opens the full activity hub (not missed-only deep link). */
export const DASHBOARD_MOBILE_PAGE_HREF: Partial<Record<PageId, string>> = {
  activity: "/dashboard/activity?filter=all",
}
