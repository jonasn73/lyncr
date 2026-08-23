import nextConfig from "eslint-config-next/core-web-vitals"

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "mobile/**",
      "Lyncr/**",
      "public/**",
      "scripts/**",
      "*.config.js",
      "*.config.mjs",
    ],
  },
  ...nextConfig,
]

export default eslintConfig
