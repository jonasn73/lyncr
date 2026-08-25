// ============================================
// Backfill the earnings ledger from historical calls
// ============================================
// Run AFTER scripts/144-compensation-plans.sql and 145-earnings-ledger.sql:
//
//   npx tsx scripts/backfill-earnings-ledger.ts                 # everything, all owners
//   npx tsx scripts/backfill-earnings-ledger.ts --days 90       # last 90 days only
//   npx tsx scripts/backfill-earnings-ledger.ts --owner <uuid>  # one business
//   npx tsx scripts/backfill-earnings-ledger.ts --dry-run       # count, write nothing
//
// Until this has run, a settled window and an un-backfilled one look identical from
// the read paths — both have zero ledger rows — so the portal and the owner payout
// view keep recomputing from the current rate. That fallback is the only reason
// earnings stay visible in the gap, and it goes away for each worker as soon as they
// have rows. Running this twice is harmless: every insert is deduped on
// (worker, source, component).
//
// The amounts reproduce what the old derive-on-read path showed, because the 144
// backfill gave each receptionist a plan effective from their created_at carrying
// their existing rate. Where a rate was changed by hand at some point in the past,
// history settles at TODAY's rate — the old code kept no record of the previous one,
// so there is nothing truer to use. Worth a spot check before locking a pay period.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "../lib/neon-database-url"
import { sweepUnsettledCalls } from "../lib/compensation/settle-call"

const BATCH = 500

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1]?.trim() ?? null
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

async function countUnsettled(ownerUserId: string | null, startIso: string, endIso: string) {
  const sql = neon(resolveNeonDatabaseUrl())
  const rows = (await sql`
    SELECT COUNT(*)::int AS pending
    FROM call_logs cl
    JOIN receptionists r ON r.id = cl.routed_to_receptionist_id
    WHERE cl.answered_at IS NOT NULL
      AND cl.ended_at IS NOT NULL
      AND lower(cl.status) IN ('answered', 'completed', 'in-progress')
      AND cl.ended_at >= ${startIso}::timestamptz
      AND cl.ended_at < ${endIso}::timestamptz
      AND (${ownerUserId}::uuid IS NULL OR cl.user_id = ${ownerUserId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM earnings_ledger el
        WHERE el.receptionist_id = r.id AND el.source_kind = 'CALL' AND el.source_id = cl.id
      )
  `) as Record<string, unknown>[]
  return Number(rows[0]?.pending ?? 0)
}

async function main() {
  const ownerUserId = argValue("--owner")
  const days = Number(argValue("--days") ?? "0")
  const dryRun = hasFlag("--dry-run")

  const endIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const startIso =
    days > 0
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      : new Date(0).toISOString()

  const pending = await countUnsettled(ownerUserId, startIso, endIso)
  console.log(
    `[backfill] ${pending} answered call(s) with no ledger row` +
      (ownerUserId ? ` for owner ${ownerUserId}` : "") +
      (days > 0 ? ` in the last ${days} days` : "")
  )

  if (dryRun) {
    console.log("[backfill] --dry-run — nothing written.")
    return
  }
  if (pending === 0) return

  let totalSettled = 0
  let totalInserted = 0

  // Each sweep only picks up calls that still have no rows, so the queue drains.
  for (;;) {
    const result = await sweepUnsettledCalls({ ownerUserId, startIso, endIso, limit: BATCH })
    if (result.scanned === 0) break
    totalSettled += result.settled
    totalInserted += result.inserted
    console.log(
      `[backfill] scanned ${result.scanned}, settled ${result.settled}, wrote ${result.inserted} row(s)` +
        ` — ${totalInserted} total`
    )
    // A batch that settles nothing would loop forever: those calls are answered but
    // earn nothing under their plan, so they will never get a row.
    if (result.inserted === 0) {
      console.log("[backfill] remaining calls earn nothing under their plan — stopping.")
      break
    }
  }

  console.log(`[backfill] done — ${totalSettled} call(s) settled, ${totalInserted} ledger row(s).`)
}

main().catch((e) => {
  console.error("[backfill] failed:", e)
  process.exitCode = 1
})
