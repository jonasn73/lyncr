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
  // Site-wide baseline security headers, plus a Content-Security-Policy shipped in
  // Report-Only mode (see CSP_DIRECTIVES below) — it can never block a real request, only
  // log violations to each visitor's browser console, so it's safe to ship while the
  // directive list is still being validated against Stripe, Telnyx WebRTC, Pusher, and
  // Sentry traffic. Do not switch the header name to the enforcing one
  // (Content-Security-Policy) without first collecting real violation reports across every
  // role (customer booking/pay pages, tech WebRTC calling, owner dashboard, admin).
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
          { key: "Content-Security-Policy-Report-Only", value: CSP_DIRECTIVES },
        ],
      },
    ]
  },
}

// Report-Only CSP directive list — see the headers() comment above for why this isn't the
// enforcing header yet. Sources, by integration:
//   Stripe (Elements, embedded Checkout, Connect, Terminal): js.stripe.com (script),
//     js.stripe.com / hooks.stripe.com / connect.stripe.com (frame — Elements iframes),
//     api.stripe.com / m.stripe.com / m.stripe.network (connect — API + telemetry beacons)
//   Telnyx WebRTC (in-browser tech calling): wss://rtc.telnyx.com, wss://rtcdev.telnyx.com
//     (grepped node_modules/@telnyx/webrtc's bundle directly for its signaling endpoints)
//   Pusher (live dashboard updates): *.pusher.com / *.pusherapp.com, ws(s) + https (the
//     specific ws-<cluster>/sockjs-<cluster> subdomain isn't worth hardcoding to a cluster)
//   Sentry (error/session reporting): *.sentry.io and *.ingest.us.sentry.io (DSN host varies
//     by org/region)
//   next/font/google self-hosts at build time — no fonts.googleapis.com needed
//   Vercel Analytics/Speed Insights post to /_vercel/... on this app's own origin — no
//     external connect-src needed
//   The geocoding providers (Google Places, Photon, Nominatim) are called server-side from
//     API routes, never from the browser — not part of this policy
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://connect.stripe.com",
  [
    "connect-src 'self'",
    "https://api.stripe.com https://m.stripe.com https://m.stripe.network",
    "https://*.pusher.com https://*.pusherapp.com wss://*.pusher.com wss://*.pusherapp.com",
    "wss://rtc.telnyx.com wss://rtcdev.telnyx.com",
    "https://*.sentry.io https://*.ingest.us.sentry.io",
  ].join(" "),
].join("; ")

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
