import { describe, expect, it, afterEach } from "vitest"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"

describe("resolveNeonDatabaseUrl", () => {
  const keys = ["DATABASE_URL", "DATABASE_URL_POOLED", "NEON_USE_DIRECT_CONNECTION", "NEON_AUTO_POOLER"] as const
  const previous: Record<string, string | undefined> = {}

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  })

  function setEnv(vars: Partial<Record<(typeof keys)[number], string>>) {
    for (const key of keys) {
      previous[key] = process.env[key]
      if (vars[key] !== undefined) process.env[key] = vars[key]
      else delete process.env[key]
    }
  }

  it("rewrites a direct Neon endpoint to its -pooler variant", () => {
    setEnv({ DATABASE_URL: "postgresql://user:pw@ep-foo.us-east-2.aws.neon.tech/db" })
    expect(resolveNeonDatabaseUrl()).toBe("postgresql://user:pw@ep-foo-pooler.us-east-2.aws.neon.tech/db")
  })

  it("leaves an already-pooled Neon endpoint unchanged", () => {
    setEnv({ DATABASE_URL: "postgresql://user:pw@ep-foo-pooler.us-east-2.aws.neon.tech/db" })
    expect(resolveNeonDatabaseUrl()).toBe("postgresql://user:pw@ep-foo-pooler.us-east-2.aws.neon.tech/db")
  })

  it("does not corrupt a local Postgres URL (regression: 127.0.0.1 became 127-pooler.0.0.1)", () => {
    setEnv({ DATABASE_URL: "postgresql://JR@127.0.0.1:55432/lyncr_e2e_test" })
    expect(resolveNeonDatabaseUrl()).toBe("postgresql://JR@127.0.0.1:55432/lyncr_e2e_test")
  })

  it("does not touch a non-Neon hostname (e.g. Supabase, per SETUP-DATABASE.md)", () => {
    setEnv({ DATABASE_URL: "postgresql://user:pw@db.abcdefgh.supabase.co:5432/postgres" })
    expect(resolveNeonDatabaseUrl()).toBe("postgresql://user:pw@db.abcdefgh.supabase.co:5432/postgres")
  })

  it("prefers DATABASE_URL_POOLED when set, unmodified", () => {
    setEnv({
      DATABASE_URL: "postgresql://user:pw@ep-foo.us-east-2.aws.neon.tech/db",
      DATABASE_URL_POOLED: "postgresql://user:pw@ep-foo-pooler.us-east-2.aws.neon.tech/db?extra=1",
    })
    expect(resolveNeonDatabaseUrl()).toBe("postgresql://user:pw@ep-foo-pooler.us-east-2.aws.neon.tech/db?extra=1")
  })

  it("returns the direct URL unmodified when NEON_USE_DIRECT_CONNECTION is set", () => {
    setEnv({
      DATABASE_URL: "postgresql://user:pw@ep-foo.us-east-2.aws.neon.tech/db",
      NEON_USE_DIRECT_CONNECTION: "true",
    })
    expect(resolveNeonDatabaseUrl()).toBe("postgresql://user:pw@ep-foo.us-east-2.aws.neon.tech/db")
  })

  it("throws a clear error when DATABASE_URL is unset", () => {
    setEnv({})
    expect(() => resolveNeonDatabaseUrl()).toThrow(/DATABASE_URL is not set/)
  })
})
