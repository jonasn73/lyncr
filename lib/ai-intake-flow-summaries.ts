// ============================================
// AI intake — human-readable flow for the dashboard
// ============================================
// These summaries mirror the intake playbooks in ai-intake-defaults.ts (reference for Telnyx assistant setup).
// and ai-intake-field-registry.ts so the UI can show branches without parsing markdown.

import type { AiIntakeProfileId } from "@/lib/business-industries"
import { INDUSTRY_CATALOG } from "@/lib/business-industries"
import { INTAKE_REGISTRY } from "@/lib/ai-intake-field-registry"

/** One branch the AI may follow after the opening line */
export type IntakeFlowBranch = {
  title: string // Branch name shown in the UI
  intent_slug: string // Value passed to submit_lyncr_lead
  bullets: string[] // Short list of what the AI tries to collect
}

/** Full card content for the “AI call flow” dashboard */
export type IntakeFlowSummary = {
  profileId: AiIntakeProfileId
  label: string // e.g. “Plumbing”
  goal: string // One sentence — what the AI is trying to do
  branches: IntakeFlowBranch[]
}

/** Bespoke playbooks (not built from INTAKE_REGISTRY) */
const BESPOKE_FLOWS: Partial<Record<AiIntakeProfileId, Omit<IntakeFlowSummary, "profileId" | "label">>> = {
  generic: {
    goal: "Understand the request, collect callback and details, then save one lead.",
    branches: [
      {
        title: "Any request",
        intent_slug: "other",
        bullets: [
          "What they need in plain language",
          "Callback number (repeat in small groups)",
          "Name if offered",
          "Service address if someone must go on-site",
        ],
      },
    ],
  },
  locksmith: {
    goal: "Classify car keys vs lockout vs other, collect the right fields, then save one lead.",
    branches: [
      {
        title: "Car keys / fob / transponder",
        intent_slug: "car_key",
        bullets: ["Make, model, year", "Vehicle location", "Callback (confirm digits)", "Name if offered"],
      },
      {
        title: "Home / business lockout",
        intent_slug: "home_lockout",
        bullets: ["Full service address", "Callback number", "Brief situation (e.g. front door)"],
      },
      {
        title: "Other (rekey, safe, commercial…)",
        intent_slug: "other",
        bullets: ["Clarifying questions", "Callback", "On-site address if needed", "One-sentence summary"],
      },
    ],
  },
  plumbing: {
    goal: "Route by urgency and job type, collect plumber-ready details, then save one lead.",
    branches: [
      {
        title: "Emergency water (leak, burst, flooding)",
        intent_slug: "plumbing_emergency",
        bullets: ["Address", "Callback", "Water still flowing?", "Main shutoff if safe"],
      },
      {
        title: "Drain / clog / backup",
        intent_slug: "plumbing_drain",
        bullets: ["Address", "Callback", "Which fixtures", "Sewage smell?", "How long blocked?"],
      },
      {
        title: "Water heater",
        intent_slug: "plumbing_water_heater",
        bullets: ["Address", "Callback", "Gas or electric", "Leaking or no hot water", "Approximate age"],
      },
      {
        title: "Fixture install / repair",
        intent_slug: "plumbing_fixture",
        bullets: ["Address", "Callback", "Fixture type", "Problem description"],
      },
      {
        title: "Everything else",
        intent_slug: "other",
        bullets: ["Callback", "Address if on-site", "Summary"],
      },
    ],
  },
  hvac: {
    goal: "Classify heating / cooling / maintenance, collect system details, then save one lead.",
    branches: [
      {
        title: "No heat",
        intent_slug: "hvac_no_heat",
        bullets: ["Address", "Callback", "Heat type if known", "Thermostat error codes", "Safety: smell / CO concern → brief guidance"],
      },
      {
        title: "No AC / not cooling",
        intent_slug: "hvac_no_ac",
        bullets: ["Address", "Callback", "Warm air, no airflow, or outdoor unit?"],
      },
      {
        title: "Maintenance / tune-up",
        intent_slug: "hvac_maintenance",
        bullets: ["Address", "Callback", "How many systems", "Preferred timing"],
      },
      {
        title: "Other",
        intent_slug: "other",
        bullets: ["Callback", "Address", "Clear summary"],
      },
    ],
  },
  electrical: {
    goal: "Safety first, then classify emergency vs power issue vs install, then save one lead.",
    branches: [
      {
        title: "Emergency (spark, smoke, shock, wires down)",
        intent_slug: "electrical_emergency",
        bullets: ["911 / leave area if immediate danger", "Callback and address if they can speak safely"],
      },
      {
        title: "Partial power / breakers",
        intent_slug: "electrical_power_issue",
        bullets: ["Address", "Callback", "Rooms affected", "How often breaker trips"],
      },
      {
        title: "Install / repair (non-emergency)",
        intent_slug: "electrical_install",
        bullets: ["Address", "Callback", "Work type (outlet, panel, EV, lighting…)"],
      },
      {
        title: "Other",
        intent_slug: "other",
        bullets: ["Callback", "Address if needed", "Summary"],
      },
    ],
  },
}

/**
 * Returns the flow diagram data for a playbook id (for the AI Call Flow dashboard).
 */
export function getIntakeFlowSummary(profileId: AiIntakeProfileId): IntakeFlowSummary {
  const label = INDUSTRY_CATALOG.find((r) => r.id === profileId)?.label ?? profileId
  const reg = INTAKE_REGISTRY[profileId]
  if (reg) {
    return {
      profileId,
      label,
      goal: reg.goal ?? "Classify the caller, collect the right details, then save one lead.",
      branches: reg.branches.map((b) => ({
        title: b.title,
        intent_slug: b.intent_slug,
        bullets: b.bullets,
      })),
    }
  }
  const bespoke = BESPOKE_FLOWS[profileId]
  if (bespoke) {
    return { profileId, label, ...bespoke }
  }
  return getIntakeFlowSummary("generic")
}
