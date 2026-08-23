import { AdminImprovementsBoard } from "@/components/admin/admin-improvements-board"
import { listAppImprovements, type AppImprovement } from "@/lib/app-improvements"

export const dynamic = "force-dynamic"

export default async function AdminImprovementsPage() {
  let items: AppImprovement[] = []
  try {
    items = await listAppImprovements()
  } catch (e) {
    console.error("[admin/improvements] page load:", e)
  }
  return <AdminImprovementsBoard initialItems={items} />
}
