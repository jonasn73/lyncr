/**
 * Sigo mobile – design tokens for consistency and easier tweaks.
 * Use these in StyleSheet so colors and spacing stay aligned across screens.
 */

// Backgrounds
export const colors = {
  background: "#0f172a",
  card: "#1e293b",
  cardBorder: "#334155",
  primary: "#6366f1",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  textDim: "#64748b",
  error: "#fca5a5",
  errorBg: "rgba(239,68,68,0.15)",
  destructive: "rgba(239,68,68,0.15)",
  destructiveBorder: "rgba(239,68,68,0.3)",
} as const

// Spacing (reuse for padding/margin)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  /** Minimum touch target height (Apple HIG 44pt) */
  touchTarget: 44,
} as const

// Border radius
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
} as const

// Font sizes
export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
} as const
