// Tech console — Key Lookup tab. Gated by the owner-granted `key_lookup` capability.

import { requireFieldTechCapability } from "@/lib/field-tech-route-guard"
import { TechPageHeader } from "@/components/tech/tech-page-header"
import { TechKeyLookup } from "@/components/tech/tech-key-lookup"

export const dynamic = "force-dynamic"

export default async function TechKeysPage() {
  const ctx = await requireFieldTechCapability("key_lookup", "/tech/dashboard/keys")

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      <TechPageHeader businessName={ctx.business_name} title="Key lookup" />
      <main className="flex-1 px-4 py-6">
        <TechKeyLookup />
      </main>
    </div>
  )
}
