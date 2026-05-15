import { View, Text } from "react-native"
import { SITE_NAME } from "@/lib/brand"
import { colors } from "@/lib/theme"

const FONT = { sm: 16, md: 18, lg: 26 } as const

export type MobileBrandWordmarkSize = keyof typeof FONT

/**
 * Same logotype as web: light Hey + heavy Sigo → reads as HeySigo.
 */
export function BrandWordmark({
  size = "md",
  variant = "default",
}: {
  size?: MobileBrandWordmarkSize
  variant?: "default" | "onDark"
}) {
  const fs = FONT[size]
  const heyColor = variant === "onDark" ? colors.textMuted : colors.textDim
  const sigoColor = colors.text
  return (
    <View
      style={{ flexDirection: "row", alignItems: "baseline" }}
      accessibilityRole="text"
      accessibilityLabel={SITE_NAME}
    >
      <Text style={{ fontSize: fs, fontWeight: "200", letterSpacing: 1.1, color: heyColor }}>Hey</Text>
      <Text style={{ fontSize: fs, fontWeight: "800", letterSpacing: 0, color: sigoColor }}>Sigo</Text>
    </View>
  )
}
