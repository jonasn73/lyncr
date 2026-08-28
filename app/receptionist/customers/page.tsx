import { CrmWorkspaceView } from "@/components/workspace-views/crm-workspace-view"
import { requireReceptionistCapability } from "@/lib/receptionist-route-guard"

export const dynamic = "force-dynamic"

/**
 * The owner's Customers & Leads pane, rendered in the receptionist console.
 *
 * Same component as /dashboard/customers — not a copy. What differs is the capability
 * context the layout wraps it in, which decides whether editing and invoicing show.
 */
export default async function ReceptionistCustomersPage() {
  await requireReceptionistCapability("crm_access", "/receptionist/customers")
  return <CrmWorkspaceView />
}
