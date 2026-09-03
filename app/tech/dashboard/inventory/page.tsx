// Tech console — Inventory Control tab. Gated by the owner-granted `inventory_control`
// capability. Same scanner the owner uses (components/dashboard/key-inventory-scanner.tsx),
// pointed at the tech-scoped /api/tech/inventory/* routes via scope="tech".

import { ScanBarcode } from "lucide-react"
import { requireFieldTechCapability } from "@/lib/field-tech-route-guard"
import { TechPageHeader } from "@/components/tech/tech-page-header"
import { KeyInventoryScannerLaunchButton } from "@/components/dashboard/key-inventory-scanner"

export const dynamic = "force-dynamic"

export default async function TechInventoryPage() {
  const ctx = await requireFieldTechCapability("inventory_control", "/tech/dashboard/inventory")

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      <TechPageHeader businessName={ctx.business_name} title="Key inventory" backHref="/tech/dashboard" />
      <main className="flex-1 space-y-4 px-4 py-6">
        <div className="rounded-2xl border border-border bg-card/70 p-4">
          <div className="flex flex-col gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-success/30 bg-success/10 text-success">
              <ScanBarcode className="h-5 w-5" aria-hidden />
            </span>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Scan to count stock</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Point your phone at a key barcode. If the SKU is already in inventory, add or remove
                one unit from Van 1, Van 2, or the shop. New barcodes open a short form for SKU, FCC
                ID, and brand.
              </p>
              <p className="text-2xs text-muted-foreground">
                Tip: use the flashlight toggle in dark vans. You can also type a SKU if the camera is
                unavailable.
              </p>
            </div>
            <KeyInventoryScannerLaunchButton
              organizationId={ctx.technician.organization_id}
              scope="tech"
              className="w-full"
            />
          </div>
        </div>
      </main>
    </div>
  )
}
