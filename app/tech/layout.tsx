// Base shell for the entire /tech segment — dark, mobile-first canvas. No gating here so the public
// /tech/login page renders without a session; the dashboard sub-layout enforces the field_tech role.
//
// Own type pairing (Sora headings / Karla body), scoped to this segment only — the rest of the
// app keeps Inter. --font-tech-heading / --font-tech-body, consumed via Tailwind arbitrary values
// (font-[family-name:var(--font-tech-heading)]) rather than touching the global --font-sans token.

import type { Metadata } from "next"
import { Sora, Karla } from "next/font/google"

const sora = Sora({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-tech-heading" })
const karla = Karla({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-tech-body" })

export const metadata: Metadata = {
  title: "Lyncr Field Console",
}

export default function TechLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`min-h-[100dvh] bg-[#0b0b12] text-foreground antialiased font-[family-name:var(--font-tech-body)] ${sora.variable} ${karla.variable}`}
    >
      {children}
    </div>
  )
}
