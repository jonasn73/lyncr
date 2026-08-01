"use client"

import { LyncrAdminDashboard } from "@/components/lyncr-admin-dashboard"
import { useLyncrAdminDashboardData } from "@/hooks/use-lyncr-admin-dashboard"

export default function AdminHomePage() {
  const {
    metrics,
    users,
    businessEconomics,
    moneyPeriod,
    setMoneyPeriod,
    loading,
    refreshing,
    fetchLatestAdminStats,
  } = useLyncrAdminDashboardData()

  return (
    <LyncrAdminDashboard
      view="home"
      metrics={metrics}
      users={users}
      businessEconomics={businessEconomics}
      moneyPeriod={moneyPeriod}
      setMoneyPeriod={setMoneyPeriod}
      loading={loading}
      refreshing={refreshing}
      fetchLatestAdminStats={fetchLatestAdminStats}
      onManageUser={() => {
        /* directory lives on /admin/businesses */
      }}
    />
  )
}
