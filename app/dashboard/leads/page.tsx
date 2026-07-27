import { redirect } from "next/navigation"

/** Leads tab is folded into CRM — keep old bookmarks working. */
export default function LeadsRoute() {
  redirect("/dashboard/customers?tab=leads")
}
