// Shared sticky header for tech console pages beyond Jobs (which keeps its own greeting
// header in tech-console.tsx). Same classes, so every tab reads as one console.

export function TechPageHeader({ businessName, title }: { businessName: string; title: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border/80 bg-[#0b0b12]/95 px-6 py-4 backdrop-blur">
      <p className="text-2xs font-medium uppercase tracking-wider text-operator">{businessName}</p>
      <h1 className="text-lg font-bold leading-tight">{title}</h1>
    </header>
  )
}
