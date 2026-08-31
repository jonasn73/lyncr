// ============================================================================
// lib/env.ts — type-safe environment variable manager (Zod-validated)
// ============================================================================
// Replaces scattered `process.env.FOO` reads with a single, autocompleted,
// runtime-validated `env` object. It does three jobs:
//   1. Validates server secrets (DATABASE_URL, TELNYX_API_KEY, …) on the server.
//   2. Validates public browser vars (NEXT_PUBLIC_*) anywhere.
//   3. Throws a loud error if client/browser code ever tries to read a server
//      secret — a hard stop that prevents an accidental credential leak.
//
// Validation is LAZY: it only runs the first time you actually read a key, so
// simply importing this file never crashes a build. Set SKIP_ENV_VALIDATION=1
// (e.g. during CI builds with no secrets) to bypass the checks entirely.

import { z } from "zod" // Zod = runtime schema validation + inferred TypeScript types.

// ----------------------------------------------------------------------------
// 1. SERVER SCHEMA — secrets that must NEVER reach the browser bundle.
// ----------------------------------------------------------------------------
const serverSchema = z.object({
  // Neon / Postgres connection string (e.g. postgresql://user:pass@host/db).
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (your Neon/Postgres connection string)"),
  // Telnyx REST API key used for numbers, voice (TeXML), and 10DLC messaging.
  TELNYX_API_KEY: z.string().min(1, "TELNYX_API_KEY is required (your Telnyx REST API key)"),
  // Stripe secret key (sk_live_… / sk_test_…) for subscriptions + credit packs.
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required (Stripe secret key, sk_…)"),
  // HMAC signing secret for session cookies — must be long enough to be safe.
  SESSION_SECRET: z
    .string()
    .min(16, "SESSION_SECRET must be at least 16 characters (generate with: openssl rand -base64 32)"),
})

// ----------------------------------------------------------------------------
// 2. CLIENT SCHEMA — public values that are safe to ship to the browser.
// ----------------------------------------------------------------------------
// Note: Next.js only inlines vars that are referenced LITERALLY as
// `process.env.NEXT_PUBLIC_*`. We do exactly that in `readClientRaw()` below
// so the values survive into the client bundle.
const clientSchema = z.object({
  // The app's public base URL, used to build webhook + redirect URLs.
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL (e.g. https://lyncr.app)"),
  // Pusher's PUBLIC app key (safe in the browser — the secret stays server-side).
  NEXT_PUBLIC_PUSHER_KEY: z.string().min(1, "NEXT_PUBLIC_PUSHER_KEY is required for the realtime HUD"),
  // Pusher cluster region; defaults to "us2" when omitted.
  NEXT_PUBLIC_PUSHER_CLUSTER: z.string().min(1).default("us2"),
  // Supabase project URL (public by design).
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
})

// ----------------------------------------------------------------------------
// Inferred TypeScript types — these give you full autocomplete on `env.*`.
// ----------------------------------------------------------------------------
type ServerEnv = z.infer<typeof serverSchema> // { DATABASE_URL: string, ... }
type ClientEnv = z.infer<typeof clientSchema> // { NEXT_PUBLIC_APP_URL: string, ... }
type Env = ServerEnv & ClientEnv // The consolidated shape exposed as `env`.

// The exact set of keys that are server-only secrets (used by the browser guard).
const SERVER_KEYS = ["DATABASE_URL", "TELNYX_API_KEY", "STRIPE_SECRET_KEY", "SESSION_SECRET"] as const
type ServerKey = (typeof SERVER_KEYS)[number]

// True when `key` is one of the protected server secrets above.
function isServerKey(key: string): key is ServerKey {
  return (SERVER_KEYS as readonly string[]).includes(key)
}

// Escape hatch: lets builds/CI without real secrets skip validation entirely.
const SKIP_VALIDATION = ["1", "true", "yes", "on"].includes(
  (process.env.SKIP_ENV_VALIDATION ?? "").trim().toLowerCase()
)

// Turn a Zod failure into one readable, multi-line error message.
// `key` is used as the path fallback when validating a single field (whose
// own issue.path is empty because it was parsed in isolation).
function formatZodError(scope: "server" | "client", error: z.ZodError, key?: string): string {
  const lines = error.issues.map((issue) => `  • ${issue.path.join(".") || key || "(root)"}: ${issue.message}`)
  return `[env] Invalid ${scope} environment variables:\n${lines.join("\n")}`
}

// ----------------------------------------------------------------------------
// 3. LAZY VALIDATION — parse on first access, then cache the result.
// ----------------------------------------------------------------------------
const serverValueCache: Partial<Record<ServerKey, unknown>> = {} // Per-key memoized server values.

// Validate + cache a SINGLE server secret. Validating per-key (instead of the
// whole schema at once) means reading one secret — e.g. SESSION_SECRET during
// login — never fails just because an UNRELATED secret (e.g. STRIPE_SECRET_KEY)
// is absent in this environment. Each route only pays for the vars it uses.
function getServerValue<K extends ServerKey>(key: K): ServerEnv[K] {
  if (key in serverValueCache) return serverValueCache[key] as ServerEnv[K] // Cached (incl. undefined when skipped).

  const raw = process.env[key]

  // When validation is skipped, trust the raw value as-is (may be undefined).
  if (SKIP_VALIDATION) {
    serverValueCache[key] = raw
    return raw as ServerEnv[K]
  }

  // Validate just this field so an unrelated missing/invalid var can't cascade.
  const parsed = serverSchema.shape[key].safeParse(raw)
  if (!parsed.success) throw new Error(formatZodError("server", parsed.error, key))

  serverValueCache[key] = parsed.data
  return parsed.data as ServerEnv[K]
}

// Validate every server secret and return the full object. Use only when you
// genuinely need all of them; individual reads should go through the proxy.
function getServerEnv(): ServerEnv {
  return {
    DATABASE_URL: getServerValue("DATABASE_URL"),
    TELNYX_API_KEY: getServerValue("TELNYX_API_KEY"),
    STRIPE_SECRET_KEY: getServerValue("STRIPE_SECRET_KEY"),
    SESSION_SECRET: getServerValue("SESSION_SECRET"),
  }
}

// Read the public vars using LITERAL references so Next.js inlines them.
function readClientRaw() {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_PUSHER_KEY: process.env.NEXT_PUBLIC_PUSHER_KEY,
    NEXT_PUBLIC_PUSHER_CLUSTER: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  }
}

const clientValueCache: Partial<Record<keyof ClientEnv, unknown>> = {} // Per-key memoized client values.

// Validate + cache a SINGLE public var. Same rationale as getServerValue: a
// page that only reads NEXT_PUBLIC_APP_URL shouldn't crash because an unrelated
// public var (e.g. NEXT_PUBLIC_SUPABASE_URL) is absent in this environment.
function getClientValue<K extends keyof ClientEnv>(key: K): ClientEnv[K] {
  if (key in clientValueCache) return clientValueCache[key] as ClientEnv[K]

  const raw = readClientRaw()[key] // Inlined NEXT_PUBLIC_* value for this key.

  // When validation is skipped, fall back to raw (cluster still defaults).
  if (SKIP_VALIDATION) {
    const fallback = key === "NEXT_PUBLIC_PUSHER_CLUSTER" ? raw ?? "us2" : raw ?? ""
    clientValueCache[key] = fallback
    return fallback as ClientEnv[K]
  }

  const parsed = clientSchema.shape[key].safeParse(raw)
  if (!parsed.success) throw new Error(formatZodError("client", parsed.error, key))

  clientValueCache[key] = parsed.data
  return parsed.data as ClientEnv[K]
}

// Validate every public var and return the full object.
function getClientEnv(): ClientEnv {
  return {
    NEXT_PUBLIC_APP_URL: getClientValue("NEXT_PUBLIC_APP_URL"),
    NEXT_PUBLIC_PUSHER_KEY: getClientValue("NEXT_PUBLIC_PUSHER_KEY"),
    NEXT_PUBLIC_PUSHER_CLUSTER: getClientValue("NEXT_PUBLIC_PUSHER_CLUSTER"),
    NEXT_PUBLIC_SUPABASE_URL: getClientValue("NEXT_PUBLIC_SUPABASE_URL"),
  }
}

// ----------------------------------------------------------------------------
// 4. EXPORTED `env` OBJECT — typed, lazy, and guarded against browser leaks.
// ----------------------------------------------------------------------------
// We use a Proxy so we can intercept every read of `env.SOMETHING` and:
//   - block server secrets from being read in the browser, and
//   - lazily run validation only for the key actually being accessed.
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    // Ignore non-string property access (e.g. Symbol lookups by frameworks).
    if (typeof prop !== "string") return undefined

    // --- Browser guard: server secrets are forbidden in the client bundle. ---
    if (isServerKey(prop)) {
      if (typeof window !== "undefined") {
        // Loud, explicit failure so a developer notices immediately.
        throw new Error(
          `[env] SECURITY: attempted to read server secret "${prop}" in the browser. ` +
            `Server-only env vars (${SERVER_KEYS.join(", ")}) must never be accessed in client code. ` +
            `Move this read into a server component, route handler, or server action.`
        )
      }
      // On the server: validate + return just this secret (no cascade).
      return getServerValue(prop)
    }

    // --- Everything else is a public client var: validate + return it. ---
    return getClientValue(prop as keyof ClientEnv)
  },
})

// Convenience helpers if you prefer calling functions over the proxy object.
export function serverEnv(): ServerEnv {
  // Hard stop if somehow invoked in the browser (defense in depth).
  if (typeof window !== "undefined") {
    throw new Error("[env] serverEnv() must not be called in the browser.")
  }
  return getServerEnv()
}

export function clientEnv(): ClientEnv {
  return getClientEnv()
}
