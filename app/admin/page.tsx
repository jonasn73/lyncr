"use client"

import { LyncrAdminDashboard } from "@/components/lyncr-admin-dashboard"
import { useLyncrAdminDashboardData } from "@/hooks/use-lyncr-admin-dashboard"

export default function AdminHomePage() {
  const { metrics, users, loading, refreshing, fetchLatestAdminStats } = useLyncrAdminDashboardData()

  return (
    <LyncrAdminDashboard
      view="home"
      metrics={metrics}
      users={users}
      loading={loading}
      refreshing={refreshing}
      fetchLatestAdminStats={fetchLatestAdminStats}
      onManageUser={() => {
        /* directory lives on /admin/businesses */
      }}
    />
  )
}
