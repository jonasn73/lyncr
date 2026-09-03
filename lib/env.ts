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
function formatZodError(scope: "server" | "client", error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
  return `[env] Invalid ${scope} environment variables:\n${lines.join("\n")}`
}

// ----------------------------------------------------------------------------
// 3. LAZY VALIDATION — parse on first access, then cache the result.
// ----------------------------------------------------------------------------
let serverCache: ServerEnv | null = null // Memoized server parse result.
let clientCache: ClientEnv | null = null // Memoized client parse result.

// Validate + cache the server secrets. Only ever called on the server.
function getServerEnv(): ServerEnv {
  if (serverCache) return serverCache // Return the cached result if we already parsed.

  // Collect the raw server values straight from the runtime environment.
  const raw = {
    DATABASE_URL: process.env.DATABASE_URL,
    TELNYX_API_KEY: process.env.TELNYX_API_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    SESSION_SECRET: process.env.SESSION_SECRET,
  }

  // When validation is skipped, trust the raw values as-is (may be undefined).
  if (SKIP_VALIDATION) {
    serverCache = raw as unknown as ServerEnv
    return serverCache
  }

  // Strictly validate; throw a clear, aggregated error if anything is missing/bad.
  const parsed = serverSchema.safeParse(raw)
  if (!parsed.success) throw new Error(formatZodError("server", parsed.error))

  serverCache = parsed.data // Cache the validated, typed values.
  return serverCache
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

// Validate + cache the public/browser vars. Safe to call on server or client.
function getClientEnv(): ClientEnv {
  if (clientCache) return clientCache // Return cached result if available.

  const raw = readClientRaw() // Grab the inlined NEXT_PUBLIC_* values.

  // When validation is skipped, fall back to raw values (cluster still defaults).
  if (SKIP_VALIDATION) {
    clientCache = {
      NEXT_PUBLIC_APP_URL: raw.NEXT_PUBLIC_APP_URL ?? "",
      NEXT_PUBLIC_PUSHER_KEY: raw.NEXT_PUBLIC_PUSHER_KEY ?? "",
      NEXT_PUBLIC_PUSHER_CLUSTER: raw.NEXT_PUBLIC_PUSHER_CLUSTER ?? "us2",
      NEXT_PUBLIC_SUPABASE_URL: raw.NEXT_PUBLIC_SUPABASE_URL ?? "",
    }
    return clientCache
  }

  // Strictly validate the public vars; throw a readable error on failure.
  const parsed = clientSchema.safeParse(raw)
  if (!parsed.success) throw new Error(formatZodError("client", parsed.error))

  clientCache = parsed.data // Cache the validated, typed values.
  return clientCache
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
      // On the server: return the validated server value.
      return getServerEnv()[prop]
    }

    // --- Everything else is a public client var: validate + return it. ---
    return getClientEnv()[prop as keyof ClientEnv]
  },
})
