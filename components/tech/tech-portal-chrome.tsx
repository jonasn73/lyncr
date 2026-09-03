// Chrome for the tech console — just the dark-palette wrapper shared by every tech page.
//
// Navigation between sections lives entirely on the home hub (components/tech/tech-hub.tsx)
// now, as a full-screen tile grid; sub-pages carry a back-to-home affordance via
// TechPageHeader's backHref instead of a persistent bottom tab bar.

export function TechPortalChrome({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-[#0b0b12] text-foreground">{children}</div>
}
