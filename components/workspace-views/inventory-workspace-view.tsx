"use client"

// Key Inventory hub — mobile-first scan entry for van / shop stock counts.

import { ScanBarcode } from "lucide-react"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"
import { KeyInventoryScannerLaunchButton } from "@/components/dashboard/key-inventory-scanner"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"

export function InventoryWorkspaceView() {
  const { activeOrganizationId } = useDashboardWorkspace()

  return (
    <WorkspacePage>
      <WorkspacePageHeader
        eyebrow="Stock"
        title="Key inventory"
        action={
          <KeyInventoryScannerLaunchButton
            organizationId={activeOrganizationId}
            className="w-full sm:w-auto"
          />
        }
      />

      <WorkspacePanel className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <ScanBarcode className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-semibold text-foreground">Scan to count stock</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Point your phone at a key barcode. If the SKU is already in inventory, add or remove one
              unit from Van 1, Van 2, or the shop. New barcodes open a short form for SKU, FCC ID, and
              brand.
            </p>
            <p className="text-xs text-muted-foreground">
              Tip: use the flashlight toggle in dark vans or warehouses. You can also type a SKU if the
              camera is unavailable.
            </p>
          </div>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
