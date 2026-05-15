import Svg, { Path, Rect } from "react-native-svg"
import { colors } from "@/lib/theme"

type BrandMarkProps = {
  /** Pixel width/height (square). */
  size?: number
  /** Dark mark on primary button, or light mark on dark background. */
  tone?: "onPrimary" | "onBackground"
}

const ON_PRIMARY = "#0c0a18"

/**
 * Same HeySigo monogram as web `components/brand-mark.tsx`.
 */
export function BrandMark({ size = 18, tone = "onPrimary" }: BrandMarkProps) {
  const fg = tone === "onPrimary" ? ON_PRIMARY : colors.text
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x="4.35" y="5.65" width="1.85" height="12.7" rx="0.92" fill={fg} opacity={0.92} />
      <Rect x="4.35" y="10.95" width="6.35" height="1.9" rx="0.45" fill={fg} opacity={0.92} />
      <Rect x="8.85" y="5.65" width="1.35" height="12.7" rx="0.67" fill={fg} opacity={0.42} />
      <Path
        fill={fg}
        d="M13.05 6.85h4.95c2.35 0 3.85 1.15 3.85 2.95 0 1.45-.75 2.45-2.2 2.85l-.12.1c1.55.35 2.52 1.35 2.52 2.95 0 2.05-1.62 3.35-4.32 3.35h-4.68v-1.85h4.45c1.38 0 2.22-.55 2.22-1.55s-.82-1.58-2.38-1.58h-2.7v-1.75h2.28c1.28 0 2.02-.55 2.02-1.48s-.78-1.48-2.12-1.48h-4.55V6.85z"
      />
    </Svg>
  )
}
