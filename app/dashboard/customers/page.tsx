import { DashboardTabView } from "@/components/dashboard-tab-views"

/** CRM UI is mounted once in {@link DashboardPresenceHost} — this route is a stub. */
export default function CustomersRoute() {
  return <DashboardTabView tab="customers" />
}
