import nextConfig from "eslint-config-next/core-web-vitals"

/**
 * Design-system guardrails.
 *
 * Every rule below encodes a cleanup that has already been done once. Without
 * them the raw values grow back — the spacing scale had drifted onto every half
 * step before it was collapsed, and the colour palette had reached 71% off-token
 * while globals.css sat there defining the right answer.
 *
 * If a rule fires, the fix is almost always "use the token", not "add a
 * disable" — the tokens are in app/globals.css.
 */
const DESIGN_TOKEN_RULES = [
  {
    // zinc/slate are two competing neutral ramps, and neither matches the
    // hue-268 canvas. Surfaces: bg-background / bg-card / bg-muted / bg-accent.
    // Borders: border-border. Text: text-foreground / text-muted-foreground.
    selector:
      "Literal[value=/(?:^|[\\s\"'`])(?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|to|via)-(?:zinc|slate)-[0-9]/]",
    message:
      "Raw zinc/slate. Use the surface tokens: bg-background, bg-card, bg-muted, bg-accent, border-border, text-foreground, text-muted-foreground.",
  },
  {
    // Status colour is semantic. emerald/amber/red have tokens with matching
    // foregrounds — and pairing a bright background with text-white is how the
    // "+ Add" button ended up at 1.88:1.
    selector:
      "Literal[value=/(?:^|[\\s\"'`])(?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|from|to|via|shadow)-(?:emerald|amber|red)-[0-9]/]",
    message:
      "Raw status colour. Use --success / --warning / --destructive, and pair a bg-* with its matching text-*-foreground, never text-white.",
  },
  {
    // 1095 hand-picked sizes existed because the ramp had no 10px or 11px step.
    // It does now: text-micro (eyebrow labels only) and text-2xs.
    selector: "Literal[value=/(?:^|[\\s\"'`])(?:[a-z0-9-]+:)*text-\\[[0-9]+px\\]/]",
    message:
      "Arbitrary font size. Use the ramp: text-micro (10px, uppercase eyebrows only), text-2xs, text-xs, text-sm, text-base, text-xl, text-3xl.",
  },
  {
    // Component internals sit on 4/8/12/16, layout rhythm on 24/32/48.
    selector:
      "Literal[value=/(?:^|[\\s\"'`])(?:[a-z0-9-]+:)*(?:gap|gap-x|gap-y|space-x|space-y|p|px|py|pt|pb|pl|pr)-(?:1\\.5|2\\.5|3\\.5|5)(?:[\\s\"'`]|$)/]",
    message:
      "Off-scale spacing. Internals use 1/2/3/4 (4/8/12/16px); layout rhythm uses 6/8/12 (24/32/48px).",
  },
]

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
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["warn", ...DESIGN_TOKEN_RULES],
    },
  },
  {
    /**
     * Light-surface exemption — NOT drift.
     *
     * These are the customer-facing artefacts: invoices, receipts, booking and
     * rescue links. They are deliberately light-themed because people print
     * them, email them and open them outside the dashboard, so they use
     * bg-white / bg-slate-50 with dark text. Forcing them onto the dark-theme
     * tokens would break what the customer actually receives.
     */
    files: [
      // NB: app/r/[token] is a Next dynamic segment — the brackets are a glob
      // character class, so match the directory instead of the literal name.
      "app/r/**",
      "app/intake-rescue/**",
      "app/locate/**",
      "app/auth/onboard/**",
      "components/dashboard/public-invoice-body.tsx",
      "components/dashboard/invoice-preview-sheet.tsx",
      "components/book/intake-book-form-client.tsx",
      "components/pay/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]

export default eslintConfig
