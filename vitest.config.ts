import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    // The scheduler renders date/time inputs in the operator's local zone, and
    // the app treats America/New_York as the default everywhere. Pinning it
    // keeps those tests meaning the same thing on a laptop and on a CI runner,
    // which is set to UTC.
    env: { TZ: "America/New_York" },
    // Vitest defaults to 5s. The first test to import
    // lib/telnyx-call-control-inbound pays the transform cost for that module
    // and its dependency graph, which measures 1.6-4.4s on an idle machine --
    // under 600ms of headroom, and it duly failed on a runner that was busy.
    // Nothing else in the suite comes close: the next slowest test is 1.1s and
    // only two of 1036 exceed a second. A genuinely hung test still fails here,
    // just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
