// Admin Finance — Lyncr's own performance, every business's real balance, and the full
// transaction ledger. Used to be the Home landing page; Home is now a cross-cutting
// overview (app/admin/page.tsx) with a link back here.

import { AdminFinanceBoard } from "@/components/admin/finance-board"

export const dynamic = "force-dynamic"

export default function AdminFinancePage() {
  return <AdminFinanceBoard />
}
