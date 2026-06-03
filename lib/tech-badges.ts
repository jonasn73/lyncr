// Lyncr field-performance badges — computed purely from a tech's job metrics (shared client + server).

export interface TechBadgeMetrics {
  completed: number
  total_invoiced_cents: number
  paid_invoices: number
}

export interface TechBadge {
  id: string
  label: string
  emoji: string
  description: string
  earned: boolean
}

/** Compute the full badge grid (earned + locked) from a tech's metrics. */
export function computeTechBadges(m: TechBadgeMetrics): TechBadge[] {
  return [
    {
      id: "first_job",
      label: "First Job",
      emoji: "🛠️",
      description: "Completed your first job",
      earned: m.completed >= 1,
    },
    {
      id: "closer",
      label: "Closer",
      emoji: "✅",
      description: "Completed 5 jobs",
      earned: m.completed >= 5,
    },
    {
      id: "speed_demon",
      label: "Speed Demon",
      emoji: "⚡",
      description: "Completed 15 jobs",
      earned: m.completed >= 15,
    },
    {
      id: "on_the_money",
      label: "On The Money",
      emoji: "💵",
      description: "Collected your first payment",
      earned: m.paid_invoices >= 1,
    },
    {
      id: "review_magnet",
      label: "Review Magnet",
      emoji: "⭐",
      description: "Collected 10 payments",
      earned: m.paid_invoices >= 10,
    },
    {
      id: "top_earner",
      label: "Top Earner",
      emoji: "💰",
      description: "Invoiced over $1,000",
      earned: m.total_invoiced_cents >= 100_000,
    },
  ]
}

/** Ids of the badges the tech has earned. */
export function earnedBadgeIds(badges: TechBadge[]): string[] {
  return badges.filter((b) => b.earned).map((b) => b.id)
}
