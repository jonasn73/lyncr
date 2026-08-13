export const dynamic = "force-dynamic"

/**
 * Lines / Routing UI is statically imported in {@link DashboardPresenceHost}
 * (`DashboardPage`) so hard refresh SSR’s Who rings next + line cards from paint seeds.
 * This route is a stub — do not mount a second DashboardPage here (would duplicate Lines).
 */
export default function DashboardRoute() {
  return null
}
