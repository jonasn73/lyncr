"use client"

// This is the Admin Home screen you see at /admin.
import { useState } from "react"
import { LyncrAdminDashboard } from "@/components/lyncr-admin-dashboard"
import { AdminUserManageDrawer } from "@/components/admin-user-manage-drawer"
import { useLyncrAdminDashboardData } from "@/hooks/use-lyncr-admin-dashboard"
import type { LyncrAdminDirectoryRow } from "@/lib/types"

export default function AdminHomePage() {
  // Load shops and money numbers from the admin API.
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
  // Which shop the Manage sheet is showing.
  const [manageUser, setManageUser] = useState<LyncrAdminDirectoryRow | null>(null)
  // Whether the Manage sheet is open.
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Open Manage when you tap a shop on Home.
  function openManageUser(row: LyncrAdminDirectoryRow) {
    setManageUser(row)
    setDrawerOpen(true)
  }

  return (
    <>
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
        onManageUser={openManageUser}
      />
      <AdminUserManageDrawer
        row={manageUser}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        fetchLatestAdminStats={fetchLatestAdminStats}
        businessEconomics={
          manageUser
            ? businessEconomics.find((b) => b.user_id === manageUser.user_id) ?? null
            : null
        }
      />
    </>
  )
}
