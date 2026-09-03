// Tech console — Wallet tab. Gated by the owner-granted `view_earnings` capability.

import { requireFieldTechCapability } from "@/lib/field-tech-route-guard"
import { TechPageHeader } from "@/components/tech/tech-page-header"
import { TechWalletCard } from "@/components/tech/tech-wallet-card"

export const dynamic = "force-dynamic"

export default async function TechWalletPage() {
  const ctx = await requireFieldTechCapability("view_earnings", "/tech/dashboard/wallet")

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      <TechPageHeader businessName={ctx.business_name} title="Wallet" backHref="/tech/dashboard" />
      <main className="flex-1 px-4 py-6">
        <TechWalletCard />
      </main>
    </div>
  )
}
