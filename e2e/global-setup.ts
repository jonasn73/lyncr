// Runs once before the whole E2E suite: brings the test database up to the real current
// schema via scripts/migrate.mjs (see next.config-adjacent playwright.config.ts for why this
// database is never production). Safe to run repeatedly — migrate.mjs is idempotent.

import { execFileSync } from "child_process"
import { readFileSync } from "fs"
import path from "path"

function loadEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch {
    // Fine in CI — DATABASE_URL comes from the workflow env instead.
  }
  return out
}

export default async function globalSetup(): Promise<void> {
  const fileEnv = loadEnvFile(path.join(__dirname, "..", ".env.test.local"))
  const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      "No DATABASE_URL for the E2E test database. Set it in .env.test.local (local) or the CI workflow env."
    )
  }
  // Refuse anything that isn't obviously a local/isolated database — the whole point of this
  // suite is that it can create, mutate, and delete data freely without any risk to production.
  const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl)
  if (!isLocal && !process.env.CI) {
    throw new Error(
      `Refusing to run E2E tests against a non-local DATABASE_URL (${databaseUrl.replace(/:[^:@]+@/, ":***@")}). ` +
        "This suite creates and deletes real data — point it at a local/throwaway database only."
    )
  }

  console.log("[e2e] bootstrapping test database schema...")
  execFileSync("node", ["scripts/migrate.mjs"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  })
}
