/**
 * HeySigo mobile — design tokens aligned with the web app (ink + indigo signal).
 * Use these in StyleSheet so colors and spacing stay aligned across screens.
 */

// Backgrounds
export const colors = {
  background: "#12101f",
  card: "#1a1f33",
  cardBorder: "#2d334d",
  primary: "#5f6ef4",
  text: "#f1f5f9",
  textMuted: "#a8b3cf",
  textDim: "#6b7694",
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
