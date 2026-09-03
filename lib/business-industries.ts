// ============================================
// Business industry (signup) ↔ AI intake profile
// ============================================
// Single catalog: each `id` is both users.industry slug and AI playbook id.

const INDUSTRY_CATALOG = [
  { id: "locksmith", label: "Locksmith" },
  { id: "plumbing", label: "Plumbing" },
  { id: "hvac", label: "HVAC / heating & cooling" },
  { id: "electrical", label: "Electrical" },
  { id: "roofing", label: "Roofing" },
  { id: "garage_door", label: "Garage door" },
  { id: "appliance_repair", label: "Appliance repair" },
  { id: "pest_control", label: "Pest control" },
  { id: "lawn_care", label: "Lawn & landscape" },
  { id: "cleaning", label: "Cleaning / janitorial" },
  { id: "painting", label: "Painting" },
  { id: "handyman", label: "Handyman" },
  { id: "auto_repair", label: "Auto repair / mechanic" },
  { id: "pool_service", label: "Pool & spa service" },
  { id: "towing", label: "Towing / roadside" },
  { id: "general_contractor", label: "General contractor" },
  { id: "it_support", label: "IT / computer support" },
  { id: "legal", label: "Legal / law firm" },
  { id: "dental", label: "Dental" },
  { id: "medical_spa", label: "Med spa / aesthetics" },
  { id: "real_estate", label: "Real estate" },
  { id: "restaurant", label: "Restaurant / food service" },
  { id: "retail", label: "Retail store" },
  { id: "fitness", label: "Gym / fitness / studio" },
  { id: "pet_services", label: "Pet grooming / vet (non-emergency)" },
  { id: "moving", label: "Moving & storage" },
  { id: "security_systems", label: "Security / alarms / cameras" },
  { id: "solar", label: "Solar / renewables" },
  { id: "flooring", label: "Flooring" },
  { id: "fencing", label: "Fencing" },
  { id: "windows_glass", label: "Windows & glass" },
  { id: "generic", label: "Other / general business" },
] as const

export type AiIntakeProfileId = (typeof INDUSTRY_CATALOG)[number]["id"]

export type UserIndustrySlug = AiIntakeProfileId

/** Ordered list for dropdowns / validation */
export const AI_INTAKE_PROFILE_IDS: AiIntakeProfileId[] = INDUSTRY_CATALOG.map((x) => x.id)

const PROFILE_ID_SET = new Set<string>(AI_INTAKE_PROFILE_IDS)

/** Signup & profile industry picker (same as catalog) */
export const SIGNUP_INDUSTRY_OPTIONS: { value: UserIndustrySlug; label: string }[] = INDUSTRY_CATALOG.map(
  (row) => ({ value: row.id, label: row.label })
)

/** True if `s` is a known profile (saved override in user_ai_intake). */
export function isAiIntakeProfileId(s: string): s is AiIntakeProfileId {
  return PROFILE_ID_SET.has(s)
}

/** Map free-text or legacy slugs → playbook id */
export function defaultProfileFromUserIndustry(
  industry: string | null | undefined
): AiIntakeProfileId {
  const n = String(industry || "generic")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
  if (PROFILE_ID_SET.has(n)) return n as AiIntakeProfileId
  const aliases: Record<string, AiIntakeProfileId> = {
    plumber: "plumbing",
    heating: "hvac",
    cooling: "hvac",
    air_conditioning: "hvac",
    electrician: "electrical",
    roof: "roofing",
    garage: "garage_door",
    appliance: "appliance_repair",
    pest: "pest_control",
    landscaping: "lawn_care",
    lawn: "lawn_care",
    house_cleaning: "cleaning",
    janitorial: "cleaning",
    mechanic: "auto_repair",
    body_shop: "auto_repair",
    pool: "pool_service",
    tow: "towing",
    contractor: "general_contractor",
    gc: "general_contractor",
    tech: "it_support",
    computer: "it_support",
    lawyer: "legal",
    law: "legal",
    dentist: "dental",
    medspa: "medical_spa",
    aesthetics: "medical_spa",
    realtor: "real_estate",
    food: "restaurant",
    cafe: "restaurant",
    shop: "retail",
    gym: "fitness",
    yoga: "fitness",
    pet: "pet_services",
    grooming: "pet_services",
    mover: "moving",
    alarm: "security_systems",
    fence: "fencing",
    window: "windows_glass",
    glass: "windows_glass",
    other: "generic",
  }
  return aliases[n] || "generic"
}

/** Short label for playbook (no slash extras) */
export function industryShortLabel(profileId: AiIntakeProfileId): string {
  const row = INDUSTRY_CATALOG.find((o) => o.id === profileId)
  if (!row) return "the team"
  return row.label.split("/")[0].trim()
}
