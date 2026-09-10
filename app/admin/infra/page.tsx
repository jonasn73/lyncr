// Admin Infra — system health (Neon/Telnyx status, webhook signatures), then
// Vercel + Neon spend this month vs. budget, by category.

import { InfraCostBoard } from "@/components/admin/infra-cost-board"
import { SystemHealthBoard } from "@/components/admin/system-health-board"

export const dynamic = "force-dynamic"

export default function AdminInfraPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-3 sm:p-6">
      <SystemHealthBoard />
      <div className="border-t border-border" />
      <InfraCostBoard />
    </div>
  )
}
