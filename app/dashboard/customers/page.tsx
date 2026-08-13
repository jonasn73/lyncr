import { CrmWorkspaceView } from "@/components/workspace-views/crm-workspace-view"

export const dynamic = "force-dynamic"

/** Statically import CRM so a hard refresh SSR’s Customers & Leads, not CrmPaneFallback. */
export default function CustomersRoute() {
  // Presence host injects isActive after mount so polls pause when this pane is hidden.
  return <CrmWorkspaceView />
}
