// Admin Calls — searchable call history across every tenant.

import { CallHistoryBoard } from "@/components/admin/call-history-board"

export const dynamic = "force-dynamic"

export default function AdminCallsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-3 sm:p-6">
      <CallHistoryBoard />
    </div>
  )
}
