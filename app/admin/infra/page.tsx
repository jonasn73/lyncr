// Admin Infra — Vercel + Neon spend this month, vs. budget, by category.

import { InfraCostBoard } from "@/components/admin/infra-cost-board"

export const dynamic = "force-dynamic"

export default function AdminInfraPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-3 sm:p-6">
      <InfraCostBoard />
    </div>
  )
}
