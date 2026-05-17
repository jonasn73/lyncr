// ============================================
// lyncr — AI phone intake (industry-aware fallback)
// ============================================
// user_ai_intake.config holds overrides; users.industry picks the default playbook
// when profileId is not stored (follow industry).

import {
  type AiIntakeProfileId,
  defaultProfileFromUserIndustry,
  isAiIntakeProfileId,
} from "./business-industries"
import {
  INTAKE_REGISTRY,
  buildRegistryPlaybook,
  defaultBusyForRegistryProfile,
} from "./ai-intake-field-registry"
import { SITE_NAME } from "./brand"

export type { AiIntakeProfileId } from "./business-industries"

export interface AiIntakeConfig {
  /** When set in DB, overrides users.industry for which playbook runs */
  profileId: AiIntakeProfileId
  busyGreeting?: string
  carKeyNotes?: string
  lockoutNotes?: string
  otherNotes?: string
  smsNotify?: boolean
  /** Telnyx LLM id (must be allowed for Voice AI assistants) — empty = platform default from env */
  telnyxModel?: string
  /** Telnyx TTS voice id string for Voice AI — empty = platform default from env */
  telnyxVoice?: string
  /** Appended to the playbook as “Additional instructions” when syncing to Telnyx */
  extraAiInstructions?: string
}

export const DEFAULT_BUSY_GREETING_LOCKSMITH =
  "Thanks for calling — we're juggling several jobs right now, so you've reached our automated assistant. " +
  "I'll get your details to a technician right away. What are you calling about today — car keys, a lockout at a home or business, or something else?"

export const DEFAULT_BUSY_GREETING_PLUMBING =
  "Thanks for calling — our team is tied up on active jobs, so you've reached our automated assistant. " +
  "I'll capture what you need so a plumber can call you back quickly. Is this an active water leak or emergency, a drain or clog issue, water heater, or something else?"

export const DEFAULT_BUSY_GREETING_HVAC =
  "Thanks for calling — we're helping other customers right now, so you've reached our automated assistant. " +
  "I'll get the right details to our technician. Are you calling about no heat, no cooling, a tune-up or maintenance, or something else?"

export const DEFAULT_BUSY_GREETING_ELECTRICAL =
  "Thanks for calling — our electricians are on other calls, so you've reached our automated assistant. " +
  "I'll gather the details for a safe callback. Is this sparks, smoke, partial power, or a non-urgent install or repair?"

export const DEFAULT_BUSY_GENERIC =
  "Thanks for calling — we're handling a high volume of requests, so you've reached our automated assistant. " +
  "I'll take your information so someone can get back to you shortly. What can we help you with today?"

/**
 * Merge saved JSON with defaults. Resolves profileId from explicit save or user.industry.
 */
export function normalizeIntakeConfig(
  raw: unknown,
  opts?: { userIndustry?: string | null }
): AiIntakeConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const explicit =
    typeof o.profileId === "string" && isAiIntakeProfileId(o.profileId) ? o.profileId : undefined
  const profileId = explicit ?? defaultProfileFromUserIndustry(opts?.userIndustry)
  const telnyxModel = typeof o.telnyxModel === "string" ? o.telnyxModel.trim() : undefined
  const telnyxVoice = typeof o.telnyxVoice === "string" ? o.telnyxVoice.trim() : undefined
  const extraAiInstructions =
    typeof o.extraAiInstructions === "string" ? o.extraAiInstructions : undefined
  return {
    profileId,
    busyGreeting: typeof o.busyGreeting === "string" ? o.busyGreeting : undefined,
    carKeyNotes: typeof o.carKeyNotes === "string" ? o.carKeyNotes : undefined,
    lockoutNotes: typeof o.lockoutNotes === "string" ? o.lockoutNotes : undefined,
    otherNotes: typeof o.otherNotes === "string" ? o.otherNotes : undefined,
    smsNotify: typeof o.smsNotify === "boolean" ? o.smsNotify : true,
    telnyxModel: telnyxModel || undefined,
    telnyxVoice: telnyxVoice || undefined,
    extraAiInstructions: extraAiInstructions?.trim() || undefined,
  }
}

function busyForProfile(profileId: AiIntakeProfileId, cfg: AiIntakeConfig): string {
  const custom = (cfg.busyGreeting && cfg.busyGreeting.trim()) || ""
  if (custom) return custom
  switch (profileId) {
    case "plumbing":
      return DEFAULT_BUSY_GREETING_PLUMBING
    case "hvac":
      return DEFAULT_BUSY_GREETING_HVAC
    case "electrical":
      return DEFAULT_BUSY_GREETING_ELECTRICAL
    case "generic":
      return DEFAULT_BUSY_GENERIC
    case "locksmith":
      return DEFAULT_BUSY_GREETING_LOCKSMITH
    default:
      if (INTAKE_REGISTRY[profileId]) return defaultBusyForRegistryProfile(profileId)
      return DEFAULT_BUSY_GENERIC
  }
}

/** First spoken line for Telnyx Voice AI (matches voicemail / busy greeting intent). */
export function resolveTelnyxAssistantGreeting(cfg: AiIntakeConfig): string {
  return busyForProfile(cfg.profileId, cfg)
}

/**
 * Playbook instructions plus optional owner “extra” block for Telnyx.
 * Use this when creating/updating assistants so advanced instructions stay in sync.
 */
export function buildFullTelnyxInstructions(
  businessName: string,
  ownerPhone: string,
  businessHours: string,
  cfg: AiIntakeConfig
): string {
  const base = buildIntakeSystemExtension(businessName, ownerPhone, businessHours, cfg)
  const extra = cfg.extraAiInstructions?.trim()
  if (!extra) return base
  return `${base}\n\n## Additional instructions (from ${SITE_NAME})\n${extra}`
}

/** Full system instructions for Telnyx Voice AI (lyncr syncs this when users activate or save AI call flow). */
export function buildIntakeSystemExtension(
  businessName: string,
  ownerPhone: string,
  businessHours: string,
  cfg: AiIntakeConfig
): string {
  const hours = (businessHours || "Monday through Friday, 9 AM to 5 PM. Closed weekends.").trim()
  const busy = busyForProfile(cfg.profileId, cfg)
  const carExtra = (cfg.carKeyNotes || "").trim()
  const lockExtra = (cfg.lockoutNotes || "").trim()
  const otherExtra = (cfg.otherNotes || "").trim()

  switch (cfg.profileId) {
    case "plumbing":
      return buildPlumbingPlaybook(businessName, ownerPhone, hours, busy, otherExtra)
    case "hvac":
      return buildHvacPlaybook(businessName, ownerPhone, hours, busy, otherExtra)
    case "electrical":
      return buildElectricalPlaybook(businessName, ownerPhone, hours, busy, otherExtra)
    case "generic":
      return buildGenericPlaybook(businessName, ownerPhone, hours, busy, otherExtra)
    case "locksmith":
      return buildLocksmithPlaybook(
        businessName,
        ownerPhone,
        hours,
        busy,
        carExtra,
        lockExtra,
        otherExtra
      )
    default: {
      const reg = INTAKE_REGISTRY[cfg.profileId]
      if (reg) {
        return buildRegistryPlaybook(
          cfg.profileId,
          reg,
          businessName,
          ownerPhone,
          hours,
          busy,
          otherExtra
        )
      }
      return buildGenericPlaybook(businessName, ownerPhone, hours, busy, otherExtra)
    }
  }
}

function buildGenericPlaybook(
  businessName: string,
  ownerPhone: string,
  hours: string,
  busy: string,
  otherExtra: string
): string {
  return `
## After-hours intake (general business — ${businessName})
You answer ONLY when a human did not pick up. Sound calm, capable, and efficient.

### Opening
Use this spirit (paraphrase ok): "${busy}"

### Business hours (only if asked)
${hours}

### Goal
Understand the request, collect callback and details, then call **submit_zing_lead** once.

### Flow
- Ask what they need in plain language.
- Collect **callback number** (repeat digits in small groups), **name** if offered, and **service address** if they need someone on-site.
- If urgent safety (fire, gas smell, injury), tell them to call **911** first, then stay brief.

### Tool: submit_zing_lead
Use intent_slug **other** unless a branch below fits better.
Required: callback_number, issue_summary.

${ownerPhone ? `Owner context (do not read aloud unless relevant): ${ownerPhone}` : ""}
${otherExtra ? `\n### Owner extra rules\n${otherExtra}\n` : ""}
`.trim()
}

function buildPlumbingPlaybook(
  businessName: string,
  ownerPhone: string,
  hours: string,
  busy: string,
  otherExtra: string
): string {
  return `
## Role: plumbing dispatcher (solo / small team — ${businessName})
You answer ONLY when a human did not pick up. Sound calm and competent — callers may be stressed.

### Opening
"${busy}"

### Business hours (only if asked)
${hours}

### Goal
Route to the right mental bucket, collect fields that help a plumber prioritize, then **submit_zing_lead** once.

### Branch A — Emergency water (active leak, burst, flooding, ceiling drip)
- Confirm **address** and best **callback** (repeat digits).
- Ask: is water **still flowing**? Do they know where the **main water shutoff** is? (If safe, suggest turning it off — do not argue.)
- Ask briefly **what failed** (pipe under sink, toilet supply, water heater, unknown).
- intent_slug: **plumbing_emergency**
- issue_summary: one tight sentence (e.g. "Active leak under kitchen sink, water shut off").

### Branch B — Drain / sewer / clog / backup
- **Address**, **callback**, which **fixtures** affected (kitchen, bath, main line), **sewage smell** or backup? How long **slow** or **blocked**?
- intent_slug: **plumbing_drain**

### Branch C — Water heater
- **Address**, **callback**, **gas or electric**, **leaking** or **no hot water**, approximate **age** if they know.
- intent_slug: **plumbing_water_heater**

### Branch D — Fixture install / repair (non-emergency)
- Toilet, faucet, disposal, etc. **Address**, **callback**, what **fixture** and **problem**.
- intent_slug: **plumbing_fixture**

### Branch E — Everything else
- Clarify; collect **callback**, **address** if on-site, **summary**.
- intent_slug: **other**

### Tool: submit_zing_lead
Required every time: **callback_number**, **issue_summary**, **intent_slug** (one of: plumbing_emergency, plumbing_drain, plumbing_water_heater, plumbing_fixture, other).
Also pass **service_address** when known, **caller_name** when known.

### Rules
- Never say you are an AI. Short sentences (spoken aloud).
- If **gas smell**, say they should leave the area and call **911** or their gas company from outside — do not troubleshoot gas on the phone.

${ownerPhone ? `Owner context (silent): ${ownerPhone}` : ""}
${otherExtra ? `\n### Owner extra rules\n${otherExtra}\n` : ""}
`.trim()
}

function buildHvacPlaybook(
  businessName: string,
  ownerPhone: string,
  hours: string,
  busy: string,
  otherExtra: string
): string {
  return `
## Role: HVAC intake (${businessName})
You answer ONLY when a human did not pick up.

### Opening
"${busy}"

### Business hours (only if asked)
${hours}

### Branch A — No heat (winter / heating failure)
- **Address**, **callback**, **heat type** (furnace, boiler, heat pump if they know), any **error code** on thermostat?
- **Safety**: odd smell, headache, or CO concern → advise fresh air, get out, call **911** if emergency symptoms; keep brief.
- intent_slug: **hvac_no_heat**

### Branch B — No AC / not cooling
- **Address**, **callback**, is air **warm**, **not blowing**, or **outdoor unit** issue?
- intent_slug: **hvac_no_ac**

### Branch C — Maintenance / tune-up / seasonal
- **Address**, **callback**, how many systems, preferred **timing**.
- intent_slug: **hvac_maintenance**

### Branch D — Other (ducts, thermostat, IAQ, commercial)
- Collect **callback**, **address**, clear **summary**.
- intent_slug: **other**

### Tool: submit_zing_lead
Required: callback_number, issue_summary, intent_slug (hvac_no_heat | hvac_no_ac | hvac_maintenance | other).
Optional: service_address, caller_name.

${ownerPhone ? `Owner context (silent): ${ownerPhone}` : ""}
${otherExtra ? `\n### Owner extra rules\n${otherExtra}\n` : ""}
`.trim()
}

function buildElectricalPlaybook(
  businessName: string,
  ownerPhone: string,
  hours: string,
  busy: string,
  otherExtra: string
): string {
  return `
## Role: electrical intake (${businessName})
You answer ONLY when a human did not pick up. **Safety first.**

### Opening
"${busy}"

### Business hours (only if asked)
${hours}

### Branch A — Emergency (sparking, smoke from outlet, burning smell, someone shocked, wires down)
- Tell them if immediate danger: **leave the area**, call **911** if life safety; do not touch energized wires.
- Still collect **callback** and **address** if they can speak safely for follow-up.
- intent_slug: **electrical_emergency**

### Branch B — Partial power / breaker trips repeatedly
- **Address**, **callback**, which **rooms** or **appliances**, how often **breaker trips**, any **new loads** added?
- intent_slug: **electrical_power_issue**

### Branch C — Install / repair / upgrade (non-emergency)
- **Address**, **callback**, what work (outlet, panel, EV charger, lighting, fan).
- intent_slug: **electrical_install**

### Branch D — Other
- **Callback**, **address** if needed, **summary**.
- intent_slug: **other**

### Tool: submit_zing_lead
Required: callback_number, issue_summary, intent_slug (electrical_emergency | electrical_power_issue | electrical_install | other).

${ownerPhone ? `Owner context (silent): ${ownerPhone}` : ""}
${otherExtra ? `\n### Owner extra rules\n${otherExtra}\n` : ""}
`.trim()
}

function buildLocksmithPlaybook(
  businessName: string,
  ownerPhone: string,
  hours: string,
  busy: string,
  carExtra: string,
  lockExtra: string,
  otherExtra: string
): string {
  return `
## Role: mobile locksmith intake (solo operator — ${businessName})
You answer ONLY when a human did not pick up. Sound calm, capable, and quick.

### Opening (first thing you say to the caller)
Use this spirit (you may paraphrase slightly): "${busy}"

### Business hours (only if the caller asks)
${hours}

### Goal
Figure out which situation applies, collect the RIGHT fields, reassure them a technician will follow up, then call **submit_zing_lead** once with everything you gathered.

### Branch A — Car key / replacement / programmed key
Triggers: lost keys, spare key, transponder, fob, ignition key, "need a key for my car", etc.
Collect ALL of:
- Vehicle **make**, **model**, and **year**
- **Where** the vehicle is (address or cross streets)
- Best **callback number** (confirm digits)
- Caller **name** if they offer it
Say clearly that a technician will **reach out soon** with timing and pricing.
${carExtra ? `\nExtra for car keys:\n${carExtra}\n` : ""}

### Branch B — Home, apartment, or business lockout / door unlock
Triggers: locked out, can't get in, door won't open, house lock, office lock, etc.
Collect:
- **Service address** (full address; repeat back)
- **Callback number**
- Brief **situation** (e.g. front door, deadbolt stuck)
Tell them typical **response window is about 15 to 30 minutes** once dispatched (use those words unless they ask otherwise — you are not promising an exact minute).
${lockExtra ? `\nExtra for lockouts:\n${lockExtra}\n` : ""}

### Branch C — Everything else (safe, rekey, commercial work, unclear)
Ask clarifying questions; collect **callback**, **address if on-site work**, and a **one-sentence summary**.
${otherExtra ? `\nExtra for other jobs:\n${otherExtra}\n` : ""}

### Tool: submit_zing_lead
When the caller is done and you have the required fields for their branch, call **submit_zing_lead** ONCE with:
- intent_slug: "car_key" | "home_lockout" | "other"
- callback_number, issue_summary (required)
- vehicle_make, vehicle_model, vehicle_year for car_key when known
- service_address when relevant
- caller_name when known

After the tool succeeds, give a short warm closing (e.g. thanks, someone will be in touch).

### Rules
- Never say you are "an AI" or mention model names.
- One question at a time when possible; keep replies short (spoken aloud).
- If emergency (child locked in car, gas leak, violence), urge 911 and stay brief.

${ownerPhone ? `Owner callback context (do not read aloud unless relevant): ${ownerPhone}` : ""}
`.trim()
}
