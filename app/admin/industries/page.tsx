// Admin Industries — coverage matrix across every signup-able industry: live account
// counts, AI script, manual job types, equipment-on-file, and receptionist layout.

import { IndustriesBoard } from "@/components/admin/industries-board"

export const dynamic = "force-dynamic"

export default function AdminIndustriesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-3 sm:p-6">
      <IndustriesBoard />
    </div>
  )
}
