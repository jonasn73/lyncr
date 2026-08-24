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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
