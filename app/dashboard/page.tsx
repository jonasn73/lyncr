import { DashboardTabView } from "@/components/dashboard-tab-views"

export const dynamic = "force-dynamic"

/** Routing UI is mounted once in {@link DashboardPresenceHost}. */
export default function DashboardRoute() {
  return <DashboardTabView tab="dashboard" />
}
