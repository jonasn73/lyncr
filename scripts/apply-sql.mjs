/**
 * Apply one or more .sql migration files to DATABASE_URL from .env.local.
 *
 * The Neon SQL Editor is the documented path (see scripts/MIGRATE-ALL.md); this is the
 * same thing from the terminal, for migrations that were skipped and need catching up.
 *
 * Usage: node scripts/apply-sql.mjs scripts/083-....sql scripts/084-....sql
 */

import { readFileSync } from "fs"
import { neon } from "@neondatabase/serverless"

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
for (const line of env.split("\n")) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) continue
  const eq = trimmed.indexOf("=")
  if (eq < 1) continue
  let value = trimmed.slice(eq + 1).trim()
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
  if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
  process.env[trimmed.slice(0, eq).trim()] = value
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local")
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

for (const file of process.argv.slice(2)) {
  const raw = readFileSync(file, "utf8")
  // Comment lines only — these migrations have no dollar-quoted bodies.
  const body = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
  const statements = body
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)

  console.log(`\n=== ${file} — ${statements.length} statements ===`)
  for (const statement of statements) {
    const label = statement.replace(/\s+/g, " ").slice(0, 70)
    try {
      await sql.query(statement)
      console.log(`  ok   ${label}`)
    } catch (e) {
      console.log(`  FAIL ${label}`)
      console.log(`       ${e.message}`)
      process.exit(1)
    }
  }
}

console.log("\nall statements applied")
