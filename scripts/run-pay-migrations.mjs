/**
 * Apply the pay-engine migrations, in order, to whatever DATABASE_URL points at.
 *
 *   node scripts/run-pay-migrations.mjs            # apply
 *   node scripts/run-pay-migrations.mjs --dry-run  # list what would run, touch nothing
 *   DATABASE_URL=<branch-url> node scripts/run-pay-migrations.mjs
 *
 * Order is not negotiable: 145 and 147 carry foreign keys into compensation_plans,
 * so 144 has to exist first. Every file is written to be safe to run twice, so a
 * partial failure can be fixed and the whole thing re-run.
 *
 * Uses @neondatabase/serverless — the driver the app already ships. Its WebSocket
 * Client (not the HTTP `neon()` helper) is what allows a whole .sql file to be sent
 * as one multi-statement batch.
 *
 * This does NOT run the ledger backfill — that is scripts/backfill-earnings-ledger.ts,
 * and it deliberately comes after you have eyeballed what these produced.
 */

import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { Client } from "@neondatabase/serverless"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Same .env.local loading as run-schema.mjs, so both behave alike.
try {
  const env = readFileSync(join(__dirname, "..", ".env.local"), "utf8")
  for (const line of env.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    // A DATABASE_URL already in the environment wins, so pointing this at a Neon
    // branch does not require editing .env.local.
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  console.warn("No .env.local found; using DATABASE_URL from the environment.")
}

const MIGRATIONS = [
  ["144-compensation-plans.sql", "versioned pay plans + backfill from receptionists"],
  ["145-earnings-ledger.sql", "immutable earnings rows"],
  ["146-work-shifts.sql", "the clock behind hourly pay and the wage floor"],
  ["147-worker-agreements.sql", "signed terms + widen team_invites.role"],
  ["149-lead-booking-attribution.sql", "who booked a job + backfill where it is certain"],
]

const dryRun = process.argv.includes("--dry-run")

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env.local or pass it inline.")
  process.exit(1)
}

// Never print the password back at the user.
const host = (() => {
  try {
    return new URL(connectionString).host
  } catch {
    return "unknown host"
  }
})()

console.log(`\nPay-engine migrations → ${host}\n`)

if (dryRun) {
  for (const [file, what] of MIGRATIONS) console.log(`  would run  ${file}  — ${what}`)
  console.log("\n--dry-run: nothing was applied.\n")
  process.exit(0)
}

const client = new Client(connectionString)
await client.connect()

let applied = 0
try {
  for (const [file, what] of MIGRATIONS) {
    const sql = readFileSync(join(__dirname, file), "utf8")
    process.stdout.write(`  ${file} … `)
    // Each file runs as one statement batch. A file that fails leaves the earlier
    // ones applied, which is fine — they are all idempotent, so fix and re-run.
    await client.query(sql)
    applied += 1
    console.log(`ok  (${what})`)
  }
} catch (e) {
  console.error(`\nFAILED after ${applied} of ${MIGRATIONS.length}.\n`)
  console.error(e instanceof Error ? e.message : e)
  console.error("\nFix the cause and re-run — every file is safe to apply twice.\n")
  await client.end()
  process.exit(1)
}

// Quick sanity read so the run ends with a number rather than a claim.
const { rows } = await client.query(`
  SELECT
    (SELECT COUNT(*) FROM receptionists) AS receptionists,
    (SELECT COUNT(*) FROM compensation_plans WHERE effective_to IS NULL) AS live_plans,
    (SELECT COUNT(*) FROM compensation_plans WHERE jsonb_array_length(components) = 0) AS empty_plans,
    (SELECT COUNT(*) FROM earnings_ledger) AS ledger_rows,
    (SELECT COUNT(*) FROM ai_leads WHERE booked_by_receptionist_id IS NOT NULL) AS attributed_leads
`)
const s = rows[0]

console.log(`\n  receptionists      ${s.receptionists}`)
console.log(`  live pay plans     ${s.live_plans}   ${
  String(s.receptionists) === String(s.live_plans) ? "" : "  <-- should match receptionists"
}`)
console.log(`  plans with no pay  ${s.empty_plans}${s.empty_plans > 0 ? "   <-- should be 0" : ""}`)
console.log(`  ledger rows        ${s.ledger_rows}   (0 until the backfill runs)`)
console.log(`  attributed leads   ${s.attributed_leads}   (small or 0 is expected)`)

console.log(`\nAll ${applied} applied. Next: check the plan components, then run`)
console.log(`  npx tsx scripts/backfill-earnings-ledger.ts --dry-run\n`)

await client.end()
