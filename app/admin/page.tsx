"use client"

import { LyncrAdminDashboard } from "@/components/lyncr-admin-dashboard"
import { useLyncrAdminDashboardData } from "@/hooks/use-lyncr-admin-dashboard"

export default function AdminHomePage() {
  const { metrics, users, loading, refreshing, refreshAdminData } = useLyncrAdminDashboardData()
  return (
    <LyncrAdminDashboard
      metrics={metrics}
      users={users}
      loading={loading}
      refreshing={refreshing}
      refreshAdminData={refreshAdminData}
    />
  )
}
