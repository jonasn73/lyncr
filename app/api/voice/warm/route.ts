// ============================================
// GET /api/voice/warm
// ============================================
// Keeps the voice webhook region warm (Vercel cron). Reduces cold-start delay before `<Dial>`.

import { warmDatabasePool } from "@/lib/db"

export const runtime = "nodejs"
export const preferredRegion = "iad1"
export const dynamic = "force-dynamic"

export async function GET() {
  await warmDatabasePool()
  return Response.json({ ok: true, region: "iad1" })
}
