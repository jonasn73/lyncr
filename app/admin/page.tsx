// Admin home — Finance is the front door: money, every business's balance, and the
// transaction ledger, with a business drill-down (account, staff, support) one tap away.

import { AdminFinanceBoard } from "@/components/admin/finance-board"

export const dynamic = "force-dynamic"

export default function AdminHomePage() {
  return <AdminFinanceBoard />
}
