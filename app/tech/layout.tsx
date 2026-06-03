// Base shell for the entire /tech segment — dark, mobile-first canvas. No gating here so the public
// /tech/login page renders without a session; the dashboard sub-layout enforces the field_tech role.

import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Lyncr Field Console",
}

export default function TechLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#0b0b12] text-zinc-100 antialiased">{children}</div>
  )
}
