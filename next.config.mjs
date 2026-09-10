import { withSentryConfig } from "@sentry/nextjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Type errors fail the build. tsc is clean and there is a guard now: an
    // error in a test file reached production while this was true, because the
    // build reports "Skipping validation of types" and never looked.
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  // Tree-shake lucide icon imports across the dashboard client graph.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // lib/local-key-images.ts does a runtime readdirSync(publicDir, "key-images", <fccId>) —
  // Turbopack's file tracer can't resolve the dynamic path, so it conservatively bundles
  // all 12.8k / 174MB of public/key-images/** into any function that imports it (the
  // vehicle key-lookup API routes). Those images are already served statically from
  // public/, so exclude them from function bundles entirely.
  outputFileTracingExcludes: {
    "*": ["public/key-images/**"],
  },
  async redirects() {
    return [
      {
        source: "/dashboard/analytics",
        destination: "/dashboard/pay",
        permanent: true,
      },
    ]
  },
  // Site-wide baseline security headers. No CSP here yet — this app loads Stripe, Telnyx
  // WebRTC, Sentry, and a maps provider client-side, and a wrong script-src/connect-src would
  // silently break payments or calling; that needs its own report-only rollout, tested against
  // each of those integrations, not a blind addition alongside everything else here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nothing embeds Lyncr in a frame (grepped for iframe/widget usage — none found);
          // the iframes in the codebase are ones Lyncr embeds (Stripe Elements, a sandboxed
          // support-email preview), which this does not affect.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // self only for the three features the app actually uses (dispatcher/tech location,
          // Telnyx WebRTC calling, key-inventory photo capture); everything else denied.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(self), microphone=(self), payment=(), usb=(), interest-cohort=()",
          },
          // No `preload`: submitting to browsers' HSTS preload list is a separate, deliberate,
          // hard-to-reverse call — do that only if asked.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  // Optional source-map upload — skip silently when SENTRY_AUTH_TOKEN is unset.
  silent: true,
  widenClientFileUpload: true,
  // automaticVercelMonitors (below, webpack-only) no-ops on this project's Turbopack build,
  // which left the crons in vercel.json with no Sentry monitors at all. _experimental.vercelCronsMonitoring
  // is @sentry/nextjs's span-based alternative — it works under either bundler by watching for
  // the `vercel-cron` user-agent header at request time instead of a build-time webpack plugin.
  _experimental: {
    vercelCronsMonitoring: true,
  },
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
})
