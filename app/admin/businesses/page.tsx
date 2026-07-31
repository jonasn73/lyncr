"use client"

import { useState } from "react"
import { LyncrAdminDashboard } from "@/components/lyncr-admin-dashboard"
import { AdminUserManageDrawer } from "@/components/admin-user-manage-drawer"
import { useLyncrAdminDashboardData } from "@/hooks/use-lyncr-admin-dashboard"
import type { LyncrAdminDirectoryRow } from "@/lib/types"

export default function AdminBusinessesPage() {
  const { metrics, users, loading, refreshing, fetchLatestAdminStats } = useLyncrAdminDashboardData()
  const [manageUser, setManageUser] = useState<LyncrAdminDirectoryRow | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  function openManageUser(row: LyncrAdminDirectoryRow) {
    setManageUser(row)
    setDrawerOpen(true)
  }

  return (
    <>
      <LyncrAdminDashboard
        view="businesses"
        metrics={metrics}
        users={users}
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
      />
    </>
  )
}
