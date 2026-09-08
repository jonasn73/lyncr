// Admin Audit — the platform-wide signup-through-every-action event feed.

import { AuditBoard } from "@/components/admin/audit-board"

export const dynamic = "force-dynamic"

export default function AdminAuditPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-3 sm:p-6">
      <AuditBoard />
    </div>
  )
}
