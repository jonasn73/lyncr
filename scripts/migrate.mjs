/**
 * Bring a Postgres database up to the current schema, and track what's applied in a
 * schema_migrations ledger from here on.
 *
 *   node scripts/migrate.mjs              # apply
 *   node scripts/migrate.mjs --dry-run    # show what would run, touch nothing
 *   DATABASE_URL=<branch-url> node scripts/migrate.mjs
 *
 * Why this exists: db:schema (run-schema.mjs) only ever ran scripts 001-004, and the other
 * ~160 numbered migrations in this directory were applied to production by hand over time,
 * with nothing recording which. A fresh database (new preview branch, new developer, disaster
 * recovery) had no reliable way to reach today's real schema. Fix: scripts/000-baseline-*.sql
 * is a `pg_dump --schema-only` snapshot of production, taken on the date in its filename —
 * every migration through BASELINE_CUTOFF is already baked into it. This runner applies that
 * snapshot to a truly empty database, then treats scripts/NNN-*.sql above the cutoff as the
 * only ones left to run — same as any other migration tool, just starting from a snapshot
 * instead of file 001.
 *
 * Three cases, detected automatically:
 *  1. Empty database (no tables at all) — runs the baseline snapshot, then records the
 *     baseline plus every scripts/NNN-*.sql at or below BASELINE_CUTOFF as already applied.
 *  2. Has tables already (an existing dev DB, or production itself) but no schema_migrations
 *     ledger yet — does NOT touch schema. Only creates the ledger and backfills the same
 *     "already applied" records, on the assumption its schema already matches the baseline
 *     (true for production, since the baseline *is* a dump of production).
 *  3. Either way, once the ledger exists: applies any scripts/NNN-*.sql above BASELINE_CUTOFF
 *     not yet recorded, in numeric order, recording each as it succeeds.
 *
 * Case 2 never runs DDL against a database that already has application tables — it only
 * creates the bookkeeping table. Nothing here drops or alters existing data.
 */

import { readFileSync, readdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { Client } from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = __dirname

// Everything at or below this migration number is already baked into BASELINE_FILE — do not
// run those files individually once the baseline has been applied. Bump this (and replace
// BASELINE_FILE with a fresh pg_dump --schema-only snapshot) only when you want to fold a long
// run of migrations into a new starting point; it is not something to update per-migration.
const BASELINE_CUTOFF = 168
const BASELINE_FILE = "000-baseline-2026-09-10.sql"

// Same .env.local loader as run-schema.mjs / run-pay-migrations.mjs.
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
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  console.warn("No .env.local found; using DATABASE_URL from the environment.")
}

const dryRun = process.argv.includes("--dry-run")

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env.local or pass it inline.")
  process.exit(1)
}

const host = (() => {
  try {
    return new URL(connectionString).host
  } catch {
    return "unknown host"
  }
})()

/** scripts/NNN-*.sql files above the baseline cutoff, in numeric order. */
function pendingMigrationFiles() {
  return readdirSync(SCRIPTS_DIR)
    .map((name) => {
      const m = name.match(/^(\d{3})-.+\.sql$/)
      return m ? { name, num: Number(m[1]) } : null
    })
    .filter((f) => f && f.num > BASELINE_CUTOFF)
    .sort((a, b) => a.num - b.num)
    .map((f) => f.name)
}

async function ensureLedgerTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      note TEXT
    )
  `)
}

async function ledgerExists(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations'`
  )
  return rows.length > 0
}

async function isEmptyDatabase(client) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`
  )
  return rows[0].n === 0
}

async function recordApplied(client, version, note) {
  await client.query(
    `INSERT INTO schema_migrations (version, note) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
    [version, note]
  )
}

async function main() {
  console.log(`\nmigrate.mjs → ${host}${dryRun ? " (dry run)" : ""}\n`)

  const client = new Client({ connectionString })
  await client.connect()

  try {
    const hadLedger = await ledgerExists(client)
    const empty = await isEmptyDatabase(client)

    if (!hadLedger && empty) {
      console.log(`Empty database — bootstrapping from ${BASELINE_FILE} (covers migrations 001-${BASELINE_CUTOFF})`)
      if (dryRun) {
        console.log("  --dry-run: would apply baseline + backfill ledger. Nothing was run.\n")
        return
      }
      const baselineSql = readFileSync(join(SCRIPTS_DIR, BASELINE_FILE), "utf8")
      await client.query("BEGIN")
      await client.query(baselineSql)
      // pg_dump's output ends with `SELECT pg_catalog.set_config('search_path', '', false)`,
      // which otherwise leaks an empty search_path into the rest of this session.
      await client.query("SET search_path TO public")
      await ensureLedgerTable(client)
      await recordApplied(client, BASELINE_FILE, "pg_dump --schema-only baseline")
      for (const [num, name] of Object.entries(await backfillList())) {
        await recordApplied(client, name, "baked into baseline")
      }
      await client.query("COMMIT")
      console.log("  baseline applied, ledger backfilled.\n")
    } else if (!hadLedger && !empty) {
      console.log("Existing database with no ledger — assuming its schema already matches the baseline.")
      console.log("Creating schema_migrations and backfilling records only. No DDL will run against existing tables.")
      if (dryRun) {
        console.log("  --dry-run: would create ledger + backfill. Nothing was run.\n")
        return
      }
      await ensureLedgerTable(client)
      await recordApplied(client, BASELINE_FILE, "backfilled — assumed already applied")
      for (const [num, name] of Object.entries(await backfillList())) {
        await recordApplied(client, name, "backfilled — assumed already applied")
      }
      console.log("  ledger created and backfilled.\n")
    } else {
      console.log("Ledger already exists.")
    }

    const pending = pendingMigrationFiles()
    const { rows: appliedRows } = await client.query(`SELECT version FROM schema_migrations`)
    const applied = new Set(appliedRows.map((r) => r.version))
    const toRun = pending.filter((name) => !applied.has(name))

    if (toRun.length === 0) {
      console.log(`Nothing pending above migration ${BASELINE_CUTOFF}.\n`)
      return
    }

    console.log(`${toRun.length} migration(s) above ${BASELINE_CUTOFF} to apply:`)
    for (const name of toRun) console.log(`  ${dryRun ? "would run" : "running "}  ${name}`)
    if (dryRun) {
      console.log("\n--dry-run: nothing was applied.\n")
      return
    }

    for (const name of toRun) {
      const sql = readFileSync(join(SCRIPTS_DIR, name), "utf8")
      await client.query(sql)
      await recordApplied(client, name, null)
      console.log(`  ok  ${name}`)
    }
    console.log(`\nAll ${toRun.length} applied.\n`)
  } finally {
    await client.end()
  }
}

/** Migration filenames 001-BASELINE_CUTOFF, keyed by number, for the backfill record. */
async function backfillList() {
  const files = readdirSync(SCRIPTS_DIR)
    .map((name) => {
      const m = name.match(/^(\d{3})-.+\.sql$/)
      return m ? { name, num: Number(m[1]) } : null
    })
    .filter((f) => f && f.num <= BASELINE_CUTOFF)
  const byNum = {}
  for (const f of files) byNum[f.num] = f.name
  return byNum
}

main().catch((e) => {
  console.error("\nFAILED.\n")
  console.error(e instanceof Error ? e.stack || e.message : e)
  process.exit(1)
})
