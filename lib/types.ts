// ============================================
// lyncr — Core Types
// ============================================

// --- Users (Business Owners) ---
export interface User {
  id: string
  email: string
  name: string
  phone: string // owner's personal cell
  business_name: string
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

/** Onboarding wizard row (`profiles` table — scripts/024-onboarding-profiles.sql). */
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

// --- Receptionists / Agents ---
export interface Receptionist {
  id: string
  user_id: string
  name: string
  phone: string
  initials: string
  color: string
  rate_per_minute: number // e.g. 0.25
  is_active: boolean
  created_at: string
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
  status: "active" | "pending" | "porting"
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
