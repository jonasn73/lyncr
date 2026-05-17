import { View, Text } from "react-native"
import { SITE_NAME, SITE_WORDMARK } from "@/lib/brand"
import { colors } from "@/lib/theme"

const FONT = { sm: 16, md: 18, lg: 26 } as const

export type MobileBrandWordmarkSize = keyof typeof FONT

/** Same logotype as web: lowercase lyncr. */
export function BrandWordmark({
  size = "md",
  variant = "default",
}: {
  size?: MobileBrandWordmarkSize
  variant?: "default" | "onDark"
}) {
  const fs = FONT[size]
  const color = variant === "onDark" ? colors.text : colors.text
  return (
    <View
      style={{ flexDirection: "row", alignItems: "baseline" }}
      accessibilityRole="text"
      accessibilityLabel={SITE_NAME}
    >
      <Text style={{ fontSize: fs, fontWeight: "700", letterSpacing: 0.2, color, textTransform: "lowercase" }}>
        {SITE_WORDMARK}
      </Text>
    </View>
  )
}
