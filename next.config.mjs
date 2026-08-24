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
  async redirects() {
    return [
      {
        source: "/dashboard/analytics",
        destination: "/dashboard/pay",
        permanent: true,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  // Optional source-map upload — skip silently when SENTRY_AUTH_TOKEN is unset.
  silent: true,
  widenClientFileUpload: true,
  // Both of these moved under `webpack` in @sentry/nextjs 10. Note that they
  // only apply to webpack builds, and this project builds with Turbopack, so
  // they no-op today -- including automaticVercelMonitors, which means the six
  // crons in vercel.json are not getting Sentry monitors despite this asking
  // for them. Kept in the correct place so the intent survives, but the
  // monitoring gap needs a different mechanism.
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
