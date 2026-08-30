// ============================================
// Why is this payment not in the owner's wallet?
// ============================================
//
//   npx tsx scripts/diagnose-wallet-visibility.ts --recent 14      # everything from 14 days
//   npx tsx scripts/diagnose-wallet-visibility.ts --name "robert"  # search by customer name
//
// Read-only. Answers the question the wallet cannot: a payment is missing either because it is
// not COMPLETED, or because it fails the ownership test the owner's queries apply --
//
//   al.user_id = <owner>  OR  (wt.job_id IS NULL AND wt.user_id = <owner>)
//
// which derives ownership from the JOB, not the payment. Job payments are stamped with the
// assigned tech, so a row whose job_id resolves to no lead (deleted, or owned by another
// account) belongs to nobody the owner's wallet can see, even when the owner ran the charge.

import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "../lib/neon-database-url"

try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local")
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // Ambient environment only.
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

const days = Number(arg("--recent") || "14") || 14
const name = (arg("--name") || "").trim()

async function main() {
  const sql = neon(resolveNeonDatabaseUrl())

  const rows = (await sql`
    SELECT
      wt.id::text AS id,
      wt.amount::float8 AS amount,
      wt.status,
      wt.payment_method,
      wt.created_at,
      wt.user_id::text AS row_user,
      wt.job_id::text AS job_id,
      wt.customer_name AS walkup_name,
      al.user_id::text AS lead_owner,
      COALESCE(
        NULLIF(TRIM(wt.customer_name), ''),
        NULLIF(TRIM(al.collected->>'customer_name'), ''),
        NULLIF(TRIM(al.collected->>'name'), ''),
        NULLIF(TRIM(al.collected->>'caller_name'), '')
      ) AS who,
      u.account_role AS row_user_role
    FROM wallet_transactions wt
    LEFT JOIN ai_leads al ON al.id = wt.job_id
    LEFT JOIN users u ON u.id = wt.user_id
    WHERE (${name || null}::text IS NULL OR (
            wt.customer_name ILIKE ${"%" + name + "%"}
            OR al.collected->>'customer_name' ILIKE ${"%" + name + "%"}
            OR al.collected->>'name' ILIKE ${"%" + name + "%"}
            OR al.collected->>'caller_name' ILIKE ${"%" + name + "%"}
          ))
      AND (${name ? 0 : days}::int = 0
           OR wt.created_at > now() - (${days}::int * interval '1 day'))
    ORDER BY wt.created_at DESC
    LIMIT 60
  `) as Record<string, unknown>[]

  if (rows.length === 0) {
    console.log(name ? `No wallet rows matching "${name}".` : `No wallet rows in ${days} days.`)
    return
  }

  console.log(`${rows.length} row(s)\n`)
  for (const r of rows) {
    const when = new Date(String(r.created_at)).toISOString().slice(0, 16).replace("T", " ")
    const amount = `$${(Number(r.amount) || 0).toFixed(2)}`.padStart(9)
    const jobId = r.job_id ? String(r.job_id).slice(0, 8) : "—"
    const leadOwner = r.lead_owner ? String(r.lead_owner).slice(0, 8) : "NO LEAD"

    // Reproduce the owner-visibility test without needing to know the owner's id: a job row is
    // visible only through its lead, a walk-up row only through its own user_id.
    const reachable = r.job_id ? (r.lead_owner ? "via lead" : "UNREACHABLE") : "via row user"

    console.log(
      `${when}  ${amount}  ${String(r.status).padEnd(9)} ${String(r.payment_method).padEnd(11)}` +
        `  job:${jobId}  leadOwner:${leadOwner}  rowUser:${String(r.row_user).slice(0, 8)}` +
        ` (${r.row_user_role ?? "?"})  ${reachable}  ${r.who ?? "—"}`
    )
  }

  // Recompute getOwnerCollectedSummary's all-time figure for each owner seen, using the exact
  // production predicate — the fastest way to tell a wrong number from a stale one.
  const owners = [...new Set(rows.map((r) => r.lead_owner || r.row_user).filter(Boolean))] as string[]
  for (const owner of owners) {
    const t = (await sql`
      SELECT
        COALESCE(SUM(wt.amount), 0)::float8 AS all_time,
        COUNT(*)::int AS rows_counted
      FROM wallet_transactions wt
      LEFT JOIN ai_leads al ON al.id = wt.job_id
      WHERE wt.status = 'COMPLETED'
        AND (al.user_id = ${owner} OR (wt.job_id IS NULL AND wt.user_id = ${owner}))
    `) as Record<string, unknown>[]
    console.log(
      `\nowner ${owner}: all-time collected $${(Number(t[0]?.all_time) || 0).toFixed(2)} ` +
        `across ${t[0]?.rows_counted} completed row(s)`
    )
  }

  const completed = rows.filter((r) => r.status === "COMPLETED")
  const unreachable = completed.filter((r) => r.job_id && !r.lead_owner)
  console.log(
    `\n${completed.length} completed, of which ${unreachable.length} unreachable ` +
      `(job_id set but no lead — invisible to the owner wallet no matter who ran it)`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
