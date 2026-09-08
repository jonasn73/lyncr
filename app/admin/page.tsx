// Admin Home — a real cross-cutting overview across every admin area, not another
// Finance page. See components/admin/admin-home-overview.tsx. Finance itself now lives
// at /admin/finance.

import { AdminHomeOverview } from "@/components/admin/admin-home-overview"

export const dynamic = "force-dynamic"

export default function AdminHomePage() {
  return <AdminHomeOverview />
}
