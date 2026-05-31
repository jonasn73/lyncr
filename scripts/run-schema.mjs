/**
 * Run the lyncr Postgres schema (creates tables).
 * Loads DATABASE_URL from .env.local and runs scripts/001-create-schema.sql
 *
 * Usage: node scripts/run-schema.mjs
 * Or:    pnpm db:schema
 */

import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env.local (Next.js style) so we get DATABASE_URL
const envPath = join(__dirname, "..", ".env.local")
try {
  const env = readFileSync(envPath, "utf8")
  for (const line of env.split("\n")) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("#")) {
      const eq = trimmed.indexOf("=")
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
        process.env[key] = value
      }
    }
  }
} catch (e) {
  console.warn("No .env.local found; using DATABASE_URL from environment.")
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env.local or the environment.")
  process.exit(1)
}

const sqlPath = join(__dirname, "001-create-schema.sql")
const sql = readFileSync(sqlPath, "utf8")

const client = new pg.Client({ connectionString })
await client.connect()
await client.query(sql)
// Apply password_hash migration if present
try {
  const sql2Path = join(__dirname, "002-add-password-hash.sql")
  const sql2 = readFileSync(sql2Path, "utf8")
  await client.query(sql2)
  console.log("002-add-password-hash.sql applied.")
} catch (_) {}
try {
  const sql3Path = join(__dirname, "003-ai-conversation-state.sql")
  const sql3 = readFileSync(sql3Path, "utf8")
  await client.query(sql3)
  console.log("003-ai-conversation-state.sql applied.")
} catch (_) {}
try {
  const sql4Path = join(__dirname, "004-phone-numbers-port-in-request-sid.sql")
  const sql4 = readFileSync(sql4Path, "utf8")
  await client.query(sql4)
  console.log("004-phone-numbers-port-in-request-sid.sql applied.")
} catch (_) {}
await client.end()
console.log("Schema applied successfully.")
