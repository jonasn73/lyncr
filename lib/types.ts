// ============================================
// lyncr — Core Types
// ============================================

// --- Users (Business Owners) ---
export type AccountRole = "owner" | "receptionist"

export interface User {
  id: string
  email: string
  name: string
  phone: string // owner's personal cell
  business_name: string
  /** owner = business dashboard; receptionist = /receptionist portal */
  account_role: AccountRole
  /** When false, skip the short callee-only whisper on forwarded inbound calls (TeXML Number url). */
  inbound_receptionist_whisper_enabled: boolean
  /** Signup industry — default AI fallback playbook when intake has no profileId override */
  industry: string
  /** Telnyx Mission Control → Voice AI → Assistant id (TeXML AIAssistant verb). */
  telnyx_ai_assistant_id: string | null
  created_at: string
  /** Prepaid balance in USD cents (requires `019-billing-admin-feedback.sql`). */
  credit_balance_cents: number
  /** Entitlements tier key: trial | starter | growth | enterprise */
  billing_plan: string
  /** Platform operator — may access `/admin` (also allow `ZING_ADMIN_EMAILS`). */
  is_platform_admin: boolean
  /** When false, do not show the answered-call customer sheet (requires `023-user-answered-call-popup-toggle.sql`). */
  answered_call_customer_popup_enabled: boolean
}

/** Onboarding wizard row (`onboarding_profiles` — scripts/025-onboarding-profiles-table.sql). */
export interface OnboardingProfile {
  user_id: string
  reserved_number: string | null
  reserved_number_display: string | null
  reserved_number_method: "buy" | "port" | null
  port_carrier: string | null
  fallback_type: "ai" | "voicemail" | null
  trade_category: string | null
  opening_line: string | null
  has_active_subscription: boolean
  /** Entitlements tier: free_trial | starter | professional | business (scripts/028). */
  subscription_tier: string
  /** Prepaid USD balance for number provisioning (scripts/028). */
  carrier_credit: number
  /** Pay-tab low wallet warning after usage drops below threshold (scripts/029). */
  low_balance_notified: boolean
  billing_cycle_start: string | null
  billing_cycle_end: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  /** Lifetime routed calls (scripts/034). */
  total_calls_routed: number
  /** Lifetime talk time in minutes (scripts/034). */
  total_minutes_used: number
  /** active | suspended | flagged — suspended blocks Telnyx routing (scripts/034). */
  account_status: string
  /** Internal operator notes (scripts/034). */
  custom_routing_note: string | null
  /** Instant SMS when AI intake saves a lead (`044-sms-lead-notifications.sql`). */
  sms_leads_enabled: boolean
  /** Primary profile alert number (`044`). */
  notification_phone: string | null
  /** Dedicated dispatch SMS target — overrides notification_phone for lead texts (`045`). */
  dispatch_sms_phone: string | null
  updated_at: string
}

export type UpdateOnboardingProfileRequest = {
  reserved_number?: string | null
  reserved_number_display?: string | null
  reserved_number_method?: "buy" | "port" | null
  port_carrier?: string | null
  fallback_type?: "ai" | "voicemail" | null
  trade_category?: string | null
  opening_line?: string | null
  has_active_subscription?: boolean
  subscription_tier?: string
  carrier_credit?: number
  low_balance_notified?: boolean
  billing_cycle_start?: string | null
  billing_cycle_end?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  total_calls_routed?: number
  total_minutes_used?: number
  account_status?: string
  custom_routing_note?: string | null
  sms_leads_enabled?: boolean
  notification_phone?: string | null
  dispatch_sms_phone?: string | null
}

// --- 10DLC SMS compliance registration (scripts/047-messaging-10dlc.sql) ---

export type TenDlcStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "submitted"
  | "pending_review"
  | "approved"
  | "rejected"
  | "failed"

export type TenDlcEntityType =
  | "SOLE_PROPRIETOR"
  | "PRIVATE_PROFIT"
  | "NON_PROFIT"
  | "PUBLIC_PROFIT"

/** A business's own A2P 10DLC brand + campaign registration. */
export interface Messaging10DlcRegistration {
  user_id: string
  entity_type: TenDlcEntityType | null
  legal_company_name: string | null
  display_name: string | null
  ein: string | null
  vertical: string | null
  website: string | null
  contact_first_name: string | null
  contact_last_name: string | null
  email: string | null
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  use_case: string | null
  campaign_description: string | null
  sample_message_1: string | null
  sample_message_2: string | null
  message_flow: string | null
  brand_id: string | null
  campaign_id: string | null
  assigned_number: string | null
  status: TenDlcStatus
  status_detail: string | null
  fee_cents: number
  fee_paid: boolean
  stripe_session_id: string | null
  created_at: string
  updated_at: string
}

export type FeedbackCategory = "issue" | "feature" | "billing" | "other"
export type FeedbackStatus = "open" | "triaged" | "closed"

export interface FeedbackSubmission {
  id: string
  user_id: string | null
  category: FeedbackCategory
  subject: string
  body: string
  status: FeedbackStatus
  created_at: string
}

/** Admin user list row with recent call volume (30 days). */
export interface AdminUserSummary {
  id: string
  email: string
  name: string
  phone: string
  business_name: string
  credit_balance_cents: number
  billing_plan: string
  is_platform_admin: boolean
  created_at: string
  calls_last_30_days: number
  talk_seconds_last_30_days: number
}

/** One call row in the operator drill-down (subset of `call_logs`). */
export interface AdminRecentCallRow {
  id: string
  created_at: string
  call_type: string
  status: string
  duration_seconds: number
  from_number: string
  to_number: string
  caller_name: string | null
  routed_to_name: string | null
  has_recording: boolean
  recording_url: string | null
}

/** GET /api/admin/users/[id] — account pulse + recent activity. */
export interface AdminUserDetail {
  user: AdminUserSummary
  receptionist_count: number
  phone_number_count: number
  recent_calls: AdminRecentCallRow[]
}

/** Lyncr operator directory row (onboarding_profiles + users). */
export interface LyncrAdminDirectoryRow {
  user_id: string
  email: string
  /** owner | receptionist — from users.account_role (040). */
  account_role: "owner" | "receptionist"
  /** Specialty tags for platform receptionists (receptionists.skills via portal_user_id). */
  receptionist_skills: string[]
  has_active_subscription: boolean
  subscription_tier: string
  phone_number: string | null
  carrier_credit: number
  total_calls_routed: number
  total_minutes_used: number
  account_status: string
  custom_routing_note: string | null
}

export type AdminUserOverrideResult = {
  user_id: string
  account_status: string
  custom_routing_note: string | null
  phone_number: string | null
  carrier_credit: number
  reset_active_lines?: boolean
}

export type LyncrAdminHealthStatus = "ok" | "error" | "unconfigured"

export interface LyncrAdminMetrics {
  total_users: number
  active_subscriptions: number
  total_carrier_credit: number
  /** Master Telnyx platform wallet — admin-only, never shown on client Pay tab. */
  telnyx_routing_pool: {
    balance_label: string
    available_credit_label: string
    balance_usd: number
    available_credit_usd: number
  } | null
  health: {
    neon: LyncrAdminHealthStatus
    telnyx: LyncrAdminHealthStatus
  }
}

// --- Receptionists / Agents ---
export type ReceptionistPayMode = "FLAT_RATE" | "PER_MINUTE"

export interface Receptionist {
  id: string
  user_id: string
  name: string
  phone: string
  initials: string
  color: string
  rate_per_minute: number // e.g. 0.25
  pay_mode: ReceptionistPayMode
  flat_rate_usd: number // e.g. 2.50 when pay_mode is FLAT_RATE
  is_active: boolean
  /** Login user for the receptionist portal (`040-receptionist-portal-role.sql`). */
  portal_user_id?: string | null
  /** Where this receptionist answers live calls (`050-receptionist-routing-endpoint.sql`). Defaults 'CELL'. */
  routing_endpoint?: "WEB" | "CELL"
  /** Telnyx SIP username the browser registers with for WEB routing. NULL = not provisioned. */
  sip_username?: string | null
  /** Telnyx Telephony Credential id (`051`) used to mint WebRTC login tokens. NULL = not provisioned. */
  sip_credential_id?: string | null
  /** Industry/specialty tags for skill-pool routing (`042-skill-routing-pool.sql`). */
  skills: string[]
  created_at: string
}

/** Payout rollup for one receptionist in the current billing cycle. */
export interface ReceptionistPayoutMetrics {
  receptionist_id: string
  receptionist_name: string
  pay_mode: ReceptionistPayMode
  rate_per_minute: number
  flat_rate_usd: number
  answered_calls: number
  total_talk_seconds: number
  total_talk_minutes: number
  total_earnings: number
  daily_breakdown: { date: string; answered_calls: number; talk_seconds: number }[]
}

/** One row in the receptionist portal earnings ledger. */
export interface ReceptionistLedgerRow {
  id: string
  created_at: string
  from_number: string
  caller_name: string | null
  status: string
  duration_seconds: number
  payout_usd: number
  business_name: string
}

/** Live availability + active call context for the receptionist header panel. */
export type ReceptionistLiveStatus =
  | { mode: "ready"; business_name: string }
  | {
      mode: "on_call"
      business_name: string
      caller_number: string
      caller_name: string | null
      started_at: string | null
    }

/** GET /api/receptionist/dashboard payload. */
export interface ReceptionistPortalDashboard {
  receptionist: Pick<
    Receptionist,
    "id" | "name" | "is_active" | "pay_mode" | "rate_per_minute" | "flat_rate_usd" | "routing_endpoint"
  >
  /** True when a sip_username is provisioned, so the WEB toggle can actually carry browser audio. */
  web_calling_available: boolean
  business_name: string
  live_status: ReceptionistLiveStatus
  metrics: {
    today_earnings: number
    pay_period_earnings: number
    total_active_talk_seconds: number
    total_active_talk_minutes: number
  }
  billing_cycle: { start: string; end: string }
  ledger: ReceptionistLedgerRow[]
}

/** Pending team invite (`041-team-invites.sql`). */
export type InviteChannel = "EMAIL" | "SMS"
export type InviteStatus = "PENDING" | "ACCEPTED" | "EXPIRED"

export interface TeamInvite {
  id: string
  /** Empty string for SMS invites until the invitee supplies one at registration. */
  email: string
  /** Empty string until the invitee completes their profile at /register. */
  first_name: string
  role: "receptionist"
  token: string
  payout_rate_usd: number
  invited_by_user_id: string
  expires_at: string
  accepted_at: string | null
  accepted_user_id: string | null
  created_at: string
  /** How the invite was delivered (`052`). Defaults 'EMAIL' on pre-migration rows. */
  channel: InviteChannel
  /** Target cell number for SMS invites (pre-fills /register). NULL for email invites. */
  phone: string | null
  /** Derived lifecycle status: PENDING / ACCEPTED / EXPIRED. */
  status: InviteStatus
}

/** Public invite preview for signup page (no raw token echoed back). */
export interface TeamInvitePreview {
  email: string
  first_name: string
  payout_rate_usd: number
  role: "receptionist"
  expires_at: string
  /** Delivery channel so /register can pre-fill the phone (SMS) or lock the email (EMAIL). */
  channel: InviteChannel
  /** Target cell number for SMS invites (pre-fills the registration form). */
  phone: string | null
}

/** One lesson inside a certification course module. */
export interface CertificationLesson {
  id: string
  title: string
  body: string
}

/** One quiz question — correctAnswer is compared server-side only. */
export interface CertificationQuizQuestion {
  id: string
  question: string
  options: string[]
  correctAnswer: string
}

/** JSON stored on certifications.module_data (`043-certifications-training.sql`). */
export interface CertificationModuleData {
  description?: string
  lessons: CertificationLesson[]
  quiz: CertificationQuizQuestion[]
}

/** Platform training course definition. */
export interface Certification {
  id: string
  name: string
  code_identifier: string
  module_data: CertificationModuleData
  created_at: string
}

export type ReceptionistBadgeStatus = "in_progress" | "certified"

/** Per-user certification progress + live routing toggle. */
export interface ReceptionistBadge {
  id: string
  user_id: string
  certification_id: string
  status: ReceptionistBadgeStatus
  active_toggle: boolean
  earned_at: string | null
  created_at: string
}

/** Certification card shown in the receptionist training portal. */
export interface TrainingCertificationCard {
  certification: Certification
  badge: ReceptionistBadge | null
  locked: boolean
  certified: boolean
}

/** Saved caller profile per account (`022-customers.sql`) — searchable on Customers. */
export interface Customer {
  id: string
  user_id: string
  phone_e164: string
  display_name: string
  company_name: string
  address_line1: string
  address_line2: string
  city: string
  region: string
  postal_code: string
  country: string
  notes: string
  source_last_call_log_id: string | null
  created_at: string
  updated_at: string
}

// --- Routing Configuration ---
export type FallbackType = "owner" | "ai" | "voicemail"

/**
 * Who answers a line (`048`):
 * - `private_only`   → only this business's own staff (receptionists.user_id = line owner)
 * - `lyncr_only`     → only shared global Lyncr network agents (receptionists.user_id IS NULL)
 * - `hybrid_fallback`→ private staff first, drop back to the network pool when none are online
 */
export type RoutingStrategy = "private_only" | "lyncr_only" | "hybrid_fallback"

export interface RoutingConfig {
  id: string
  user_id: string
  business_number: string | null // null = default/global config; E.164 = config for that specific number
  selected_receptionist_id: string | null // null = route to owner
  fallback_type: FallbackType
  ai_greeting: string
  ring_timeout_seconds: number // how long to ring before fallback
  /** When AI fallback + no receptionist: ring owner's cell first, then Voice AI on no-answer. */
  ai_ring_owner_first: boolean
  /** Skill-pool tag — when set, route to platform receptionists with matching skills (`042`). */
  industry_tag: string | null
  /** Private vs shared Lyncr network routing (`048`). Defaults to `private_only`. */
  routing_strategy: RoutingStrategy
  /** Allow drop-back to shared Lyncr network agents when no private staff are online (`048`). */
  allow_lyncr_network_fallback: boolean
  /** Seconds to ring private staff before falling back to the Lyncr network (`049`). Defaults to 15. */
  private_ring_timeout_seconds: number
  updated_at: string
}

// --- Phone Numbers ---
export interface PhoneNumber {
  id: string
  user_id: string
  provider_number_sid: string
  number: string // e.g. "+15551234567"
  friendly_name: string // e.g. "(555) 123-4567"
  label: string // e.g. "Main Line"
  type: "local" | "toll-free"
  status: "active" | "pending" | "porting" | "released"
  /** Per-line industry tag for skill-pool routing (`042`). */
  industry_tag: string | null
  /** How matched receptionists are dialed — sequential or simultaneous (`042`). */
  routing_pool_mode: "sequential" | "simultaneous"
  created_at: string
}

/** Effective no-answer behavior for one business line (from GET /api/numbers/mine). */
export interface PhoneNumberRoutingSummary {
  fallback_type: FallbackType
  /** Saved routing says AI for this line (per-number or inherited default). */
  ai_fallback_selected: boolean
  /** Account has `users.telnyx_ai_assistant_id` — Telnyx can run Voice AI. */
  telnyx_assistant_linked: boolean
  /** Callers will actually get AI after no-answer (selected + assistant linked). */
  ai_fallback_live: boolean
  /** Who rings first for this DID (null = business owner cell). */
  ring_first_receptionist_id: string | null
}

/** In-app row from Telnyx porting webhooks (`016-porting-notifications.sql`). */
export interface PortingNotification {
  id: string
  user_id: string
  telnyx_event_id: string
  porting_order_id: string | null
  event_type: string
  title: string
  body: string
  read_at: string | null
  created_at: string
}

// --- Call Logs ---
export type CallType = "incoming" | "outgoing" | "missed" | "voicemail"

/** Row from ai_leads — legacy tool webhooks / future Telnyx lead hooks. */
export interface AiLead {
  id: string
  user_id: string
  caller_e164: string | null
  intent_slug: string | null
  collected: Record<string, unknown>
  summary: string | null
  sms_sent: boolean
  created_at: string
}

export interface CallLog {
  id: string
  user_id: string
  provider_call_sid: string
  from_number: string
  to_number: string
  caller_name: string | null
  call_type: CallType
  status: string // provider status: completed, no-answer, busy, etc.
  duration_seconds: number
  routed_to_receptionist_id: string | null
  routed_to_name: string | null
  has_recording: boolean
  recording_url: string | null
  recording_duration_seconds: number | null
  first_ring_at?: string | null
  answered_at?: string | null
  ended_at?: string | null
  setup_duration_ms?: number | null
  post_dial_delay_ms?: number | null
  created_at: string
}

// --- Analytics / Payroll ---
export interface AgentPaySummary {
  receptionist_id: string
  receptionist_name: string
  total_calls: number
  total_minutes: number
  rate_per_minute: number
  pay_mode: ReceptionistPayMode
  flat_rate_usd: number
  total_earnings: number
  daily_breakdown: {
    day: string // e.g. "Mon", "Tue"
    minutes: number
  }[]
}

export interface WeeklyPayroll {
  week_start: string
  week_end: string
  agents: AgentPaySummary[]
  total_payout: number
  total_minutes: number
}

// --- API Request/Response Types ---
export interface UpdateRoutingRequest {
  selected_receptionist_id: string | null
  fallback_type?: FallbackType
  ai_greeting?: string
  ring_timeout_seconds?: number
  ai_ring_owner_first?: boolean
  /** Hybrid network routing strategy (`048`). */
  routing_strategy?: RoutingStrategy
  /** Allow drop-back to shared Lyncr network agents (`048`). */
  allow_lyncr_network_fallback?: boolean
  /** Seconds to ring private staff before Lyncr network fallback (`049`). */
  private_ring_timeout_seconds?: number
  business_number?: string | null // E.164 number for per-number routing; omit or null for the default config
}

export interface BuyNumberRequest {
  area_code: string
  type: "local" | "toll-free"
}

export interface PortNumberRequest {
  number: string
  current_carrier?: string // optional; carrier can often be looked up from the number
}

export interface SearchNumbersResponse {
  numbers: {
    number: string
    friendly_name: string
    type: "local" | "toll-free"
    monthly_cost: number
  }[]
}
