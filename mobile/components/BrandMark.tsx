import Svg, { Path, Rect } from "react-native-svg"
import { colors } from "@/lib/theme"

type BrandMarkProps = {
  /** Pixel width/height (square). */
  size?: number
  /** Dark mark on primary button, or light mark on dark background. */
  tone?: "onPrimary" | "onBackground"
}

const ON_PRIMARY = "#0c0a18"

/** Same lyncr monogram as web `components/brand-mark.tsx`. */
export function BrandMark({ size = 18, tone = "onPrimary" }: BrandMarkProps) {
  const fg = tone === "onPrimary" ? ON_PRIMARY : colors.text
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x="8.25" y="5.5" width="2.35" height="13" rx="1.15" fill={fg} />
      <Path
        fill={fg}
        opacity={0.92}
        d="M8.42 18.5h7.35c.95 0 1.55.52 1.55 1.35 0 .88-.68 1.4-1.78 1.4H8.42V18.5z"
      />
    </Svg>
  )
}
