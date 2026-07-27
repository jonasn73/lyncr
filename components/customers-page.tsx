"use client"

import { Suspense } from "react"
import { CrmWorkspaceView } from "@/components/workspace-views/crm-workspace-view"

/** Customers route — CRM hub (list + profile). Legacy sheet editor replaced. */
export function CustomersPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh] w-full" aria-busy="true" aria-label="Loading CRM" />}>
      <CrmWorkspaceView />
    </Suspense>
  )
}
