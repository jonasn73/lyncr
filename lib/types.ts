// ============================================
// lyncr — Core Types
// ============================================

// --- Users (Business Owners) ---
export type AccountRole = "owner" | "receptionist" | "field_tech"

/** Operator provisioning lifecycle (082-operator-onboarding.sql). */
export type OperatorOnboardingStatus = "PENDING_INVITE" | "DEVICE_TESTING" | "ACTIVE_READY"

/** One business workspace an operator is cleared to answer for. */
export interface OperatorAssignedWorkspace {
  organization_id?: string | null
  business_name: string
  line_e164?: string | null
  industry_tag?: string | null
}

/** Platform-admin operator roster row (`082`). */
export interface OperatorAdminRow {
  id: string
  email: string
  phone: string | null
  name: string
  timezone: string | null
  operator_onboarding_status: OperatorOnboardingStatus | null
  invitation_expires_at: string | null
  assigned_workspaces: OperatorAssignedWorkspace[]
  created_at: string
  /** invited | active | disabled */
  invite_status: string | null
  /** False when disabled or receptionist row is inactive. */
  is_active: boolean
}

/** Workspace + line option for admin operator invite picker. */
export interface AdminOperatorWorkspaceOption {
  organization_id: string
  business_name: string
  owner_email: string
  line_e164: string | null
  line_label: string | null
}

/** Platform owner quick-toggle profile — legacy; superseded by AdminNotificationPreferences. */
export type MasterToggleMode = "tech" | "admin" | "passive"

/** Granular platform-admin notification channel toggles (`080-admin-notification-preferences.sql`). */
export interface AdminNotificationPreferences {
  sms_local_job_assignments: boolean
  sms_global_out_of_state_bookings: boolean
  push_live_inbound_ringing: boolean
  push_operator_dispositions: boolean
  email_daily_revenue_digest: boolean
  email_system_fallback_alerts: boolean
}

export interface User {
  id: string
  email: string
  name: string
  phone: string // owner's personal cell
  business_name: string
  /** owner = business dashboard; receptionist = /receptionist portal */
  account_role: AccountRole
  /** owner = business dashboard; receptionist = /receptionist; field_tech = /tech mobile console */
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
  /** Legacy mode column — superseded by admin_notification_preferences. */
  master_toggle_mode?: MasterToggleMode
  /** Admin-only per-channel notification toggles (`080-admin-notification-preferences.sql`). */
  admin_notification_preferences?: AdminNotificationPreferences
  /** When false, do not show the answered-call customer sheet (requires `023-user-answered-call-popup-toggle.sql`). */
  answered_call_customer_popup_enabled: boolean
}

/** A field technician on an owner's roster (`field_technicians` — scripts/061). */
export interface FieldTechnician {
  id: string
  /** The business owner this tech works for. */
  owner_user_id: string
  /** Workspace this tech belongs to (`078-field-technicians-organization.sql`). */
  organization_id: string | null
  /** The tech's login user (users.id, account_role=field_tech). Null until linked. */
  portal_user_id: string | null
  name: string
  phone: string
  /** Login email (joined from the linked users row). */
  email: string | null
  is_active: boolean
  /** True while the tech still has a pending SMS invite (hasn't set their password yet). */
  invite_pending?: boolean
  created_at: string
}

/** A single invoice line item. */
export interface InvoiceLineItem {
  label: string
  amount_cents: number
}

/** An on-site invoice raised by a tech (`job_invoices` — scripts/061). */
export interface JobInvoice {
  id: string
  lead_id: string | null
  owner_user_id: string
  tech_user_id: string | null
  customer_name: string | null
  customer_phone: string | null
  line_items: InvoiceLineItem[]
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  payment_status: "unpaid" | "pending" | "paid" | "recorded"
  payment_method: "card" | "cash" | "none" | null
  card_last4: string | null
  created_at: string
  paid_at: string | null
}

/** A booked job as shown to the owner (assign dropdown) and the tech (console). */
export interface DispatchJob {
  id: string
  customer_name: string | null
  customer_phone: string | null
  location: string | null
  summary: string | null
  job_status: string | null
  assigned_tech_id: string | null
  assigned_tech_name: string | null
  /** Geocoded service-address coordinates (null until the address is resolved). */
  latitude: number | null
  longitude: number | null
  created_at: string
  /** Tech must verify key style / door electronics before cutting. */
  field_verification_required?: boolean | null
}

/** Owner calendar event derived from ai_leads (BOOKED / PENDING_TIME). */
export interface SchedulerEvent {
  id: string
  customer_name: string | null
  customer_phone: string | null
  location: string | null
  summary: string | null
  disposition: string | null
  /** ISO timestamp used for calendar placement. */
  scheduled_at: string
  /** True when scheduled_at was inferred from created_at (no structured time set). */
  scheduled_tentative: boolean
  created_at: string
  /** Manual / intake job type label (e.g. Lockout, Auto Detail). */
  job_type: string | null
  /** Block length on the hourly grid (minutes). */
  duration_minutes: number
  /** Assigned field tech login user id. */
  assigned_tech_id: string | null
  assigned_tech_name: string | null
  /** Vehicle year (e.g. 2021). */
  vehicle_year: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  /** 17-character VIN when captured at intake or edit. */
  vehicle_vin?: string | null
  /** Free-text job site notes from intake or manual booking. */
  job_notes: string | null
  /** Geocoded job site latitude (from collected.customer_lat). */
  latitude: number | null
  /** Geocoded job site longitude (from collected.customer_lng). */
  longitude: number | null
  /** Field progress: assigned | en_route | arrived | completed */
  job_status: string | null
  /** Dispatch pipeline: unassigned_pool | DISPATCHED | pending_review */
  dispatch_status: string | null
  /** ISO timestamp when the job was marked completed (collected.completed_at). */
  completed_at?: string | null
  /** Last quoted price in cents (from collected.last_quoted_price_cents). */
  quoted_price_cents?: number | null
  /** Service quote calculator id (lockout, key_gen, …). */
  service_quote_type_id?: string | null
  key_fcc_id?: string | null
  key_frequency?: string | null
  key_chipset?: string | null
  key_style?: string | null
  key_variant_id?: string | null
  key_profile_id?: string | null
  discount_applied?: string | null
  baseline_quoted_price_cents?: number | null
  /** Tech must verify key style / door electronics before cutting. */
  field_verification_required?: boolean | null
}
export interface UnassignedPoolJob {
  id: string
  customer_name: string | null
  customer_phone: string | null
  location: string | null
  neighborhood: string | null
  summary: string | null
  job_type: string | null
  vehicle_year: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  /** 17-character VIN when captured at intake or edit. */
  vehicle_vin?: string | null
  job_notes: string | null
  scheduled_at: string | null
  duration_minutes: number
  dispatch_status: string | null
  created_at: string
  /** State / province from collected.region. */
  region?: string | null
  /** ZIP from collected.postal_code. */
  postal_code?: string | null
  latitude: number | null
  longitude: number | null
  quoted_price_cents?: number | null
  service_quote_type_id?: string | null
  key_fcc_id?: string | null
  key_frequency?: string | null
  key_chipset?: string | null
  key_style?: string | null
  key_variant_id?: string | null
  key_profile_id?: string | null
  discount_applied?: string | null
  baseline_quoted_price_cents?: number | null
  field_verification_required?: boolean | null
}

/** Active dispatch pipeline job (scheduled + hopper) for map split view. */
export interface ActivePipelineJob extends UnassignedPoolJob {
  job_status: string | null
  assigned_tech_id: string | null
  assigned_tech_name: string | null
}

/** Phone lookup hits across pool + calendar. */
export interface SchedulerPhoneLookupResult {
  pool: UnassignedPoolJob[]
  scheduled: SchedulerEvent[]
}

/** A field tech's last-known live position for the owner's dispatch map. */
export interface TechLiveLocation {
  tech_user_id: string
  name: string
  status: string | null
  latitude: number
  longitude: number
}

/** Owner's automated customer SMS engine settings (`onboarding_profiles` — scripts/062). */
export interface OwnerSmsSettings {
  sms_booking_enabled: boolean
  sms_route_enabled: boolean
  sms_review_enabled: boolean
  sms_booking_template: string | null
  sms_route_template: string | null
  sms_review_template: string | null
  google_review_url: string | null
}

/** Dispatch context for a single job, used by the SMS pipeline + tracking. */
export interface LeadDispatchContext {
  lead_id: string
  owner_user_id: string
  customer_name: string | null
  customer_phone: string | null
  location: string | null
  time_slot: string | null
  summary: string | null
  assigned_tech_id: string | null
  job_status: string | null
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
  /** Platform-admin PSTN override — inbound calls bypass standard routing when set (`072`). */
  admin_routing_override_phone?: string | null
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
  /** Surrogate row id (`068-10dlc-multi-tenant.sql`). */
  id?: string
  /** Workspace this brand/campaign belongs to (`068-10dlc-multi-tenant.sql`). */
  organization_id?: string | null
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
  /**
   * Computed classification for the directory tabs/badges:
   *   RECEPTIONIST — linked to a receptionists row (portal_user_id)
   *   OWNER        — has a business_name
   *   ADMIN        — neither (platform/operator accounts)
   */
  role: "OWNER" | "RECEPTIONIST" | "ADMIN"
  /** users.business_name — shown inline on the Business Owner badge. */
  business_name: string
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

/** One in-progress call for the admin Live Traffic Pulse feed. */
export interface AdminLiveCall {
  id: string
  business_name: string
  email: string
  operator: string | null
  from_number: string
  status: string
  /** ISO timestamp the call connected/started — the client renders a live counter from this. */
  started_at: string
  connected: boolean
}

/** A historical call-log row for the platform-admin call history widget. */
export interface AdminCallHistoryRow {
  id: string
  /** Provider trunk identifier (call_logs.provider_call_sid). */
  call_uuid: string
  /** Flow direction (call_logs.call_type): incoming | outgoing | missed | voicemail | manual_intake. */
  direction: string
  from_number: string
  to_number: string
  status: string
  duration_seconds: number
  created_at: string
}

/** One provisioned DID in the admin tenant drawer. */
export type AdminTenantControlPhoneLine = {
  id: string
  number: string
  label: string
  status: string
  type: string
  organization_id: string | null
  /** Line-level admin override (`073`). */
  admin_routing_override_phone: string | null
  /** Effective override (line, else workspace). */
  effective_admin_routing_override_phone: string | null
}

/** One workspace row in the admin Business Owner control hub. */
export interface AdminTenantControlOrganization {
  id: string
  name: string
  is_default: boolean
  /** Workspace-level admin inbound PSTN override (`073`). */
  admin_routing_override_phone?: string | null
  sms_registration_status: SmsRegistrationOrgStatus
  sms_registration: {
    id: string
    legal_business_name: string
    status: SmsRegistrationStatus
  } | null
  messaging_10dlc: {
    status: TenDlcStatus
    brand_id: string | null
    campaign_id: string | null
    legal_company_name: string | null
    display_name: string | null
  } | null
}

/** Pending team invite surfaced in the admin drawer. */
export interface AdminTenantControlPendingInvite {
  id: string
  /** Email address or phone number the invite was sent to. */
  target: string
  channel: InviteChannel
  status: InviteStatus
  created_at: string
  expires_at: string
}

/** Tenant feature overrides + provisioned lines shown in the admin tenant drawer. */
export interface AdminTenantControls {
  feature_flags: Record<string, boolean>
  phone_lines: AdminTenantControlPhoneLine[]
  /** True when the owner has more than one workspace in `organizations`. */
  is_multi_workspace: boolean
  team_roster: {
    active_receptionists: number
    active_field_technicians: number
  }
  organizations: AdminTenantControlOrganization[]
  pending_invites: AdminTenantControlPendingInvite[]
}

/** One row in the receptionist payout ledger view. */
export interface OperatorPayoutRow {
  receptionist_id: string
  name: string
  phone: string
  is_active: boolean
  is_network_agent: boolean
  rate_per_minute: number
  total_calls: number
  total_minutes: number
  avg_answer_ms: number | null
  earned_usd: number
  paid_usd: number
  accrued_usd: number
  last_paid_at: string | null
}

export type AdminUserOverrideResult = {
  user_id: string
  account_status: string
  custom_routing_note: string | null
  phone_number: string | null
  carrier_credit: number
  admin_routing_override_phone?: string | null
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
  /** Fallback cell when primary routing endpoint fails (`082-operator-onboarding.sql`). */
  backup_phone_number?: string | null
  /** Business workspaces this operator may answer for (`082`). */
  assigned_workspaces?: OperatorAssignedWorkspace[]
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

/**
 * Company attributes shown on the receptionist web-phone screen-pop so an operator can answer
 * "as" the business being called. `business_instructions` mirrors onboarding_profiles.routing_instructions.
 */
export interface CompanyBriefing {
  found: boolean
  business_name: string | null
  business_hours: string | null
  service_rules: string | null
  business_instructions: string | null
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
  /** When true, callers hear a short greeting before the team cell rings (`081`). */
  inbound_caller_greeting_enabled: boolean
  updated_at: string
}

// --- Porting orders (native LNP — scripts/066) ---
export type PortingOrderStatus =
  | "pending"
  | "processing"
  | "completed"
  | "rejected"
  | "action_required"
  | "pending_info"
  | "submitted"
  | "pending_carrier_review"

export interface PortingOrder {
  id: string
  owner_user_id: string
  organization_id: string | null
  phone_number: string
  current_carrier: string
  account_number: string
  pin_or_sid: string | null
  status: PortingOrderStatus
  telnyx_order_id: string | null
  telnyx_status: string | null
  /** Carrier rejection or action-required text from Telnyx (e.g. invalid PIN). */
  carrier_rejection_reason?: string | null
  created_at: string
  updated_at: string
}

// --- Organizations (multi-business workspaces — scripts/065) ---
export interface Organization {
  id: string
  owner_user_id: string
  name: string
  is_default: boolean
  created_at: string
  /** Carrier SMS compliance status for this workspace (`067-sms-registrations.sql`). */
  sms_registration_status?: SmsRegistrationOrgStatus | null
  /** Workspace-level admin inbound PSTN override (`073`). */
  admin_routing_override_phone?: string | null
}

export type SmsRegistrationStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED"

export type SmsRegistrationOrgStatus = "NONE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED"

export interface SmsRegistration {
  id: string
  organization_id: string | null
  owner_user_id: string
  legal_business_name: string
  entity_type: string
  tax_id_ein: string | null
  street: string
  city: string
  state: string
  postal_code: string
  use_case_description: string
  status: SmsRegistrationStatus
  created_at: string
  updated_at: string
}

export type SmsMessageDirection = "inbound" | "outbound"

/** One SMS in a customer thread (`069-sms-messages.sql`). */
export interface SmsMessage {
  id: string
  organization_id: string | null
  owner_user_id: string
  phone_number_id: string | null
  direction: SmsMessageDirection
  from_number: string
  to_number: string
  body: string
  customer_phone: string
  telnyx_message_id: string | null
  status: string
  created_at: string
}

// --- Phone Numbers ---
export type PhoneLineSourceProvider = "telnyx" | "external"

export interface PhoneNumber {
  id: string
  user_id: string
  /** Workspace this line belongs to (`065-organizations-external-lines.sql`). */
  organization_id: string | null
  provider_number_sid: string
  number: string // e.g. "+15551234567"
  friendly_name: string // e.g. "(555) 123-4567"
  label: string // e.g. "Main Line"
  type: "local" | "toll-free"
  status: "active" | "pending" | "porting" | "released"
  /** telnyx = purchased on Lyncr; external = Twilio/other forward to our TeXML webhook. */
  source_provider: PhoneLineSourceProvider
  /** Owner confirmed webhook routing for external lines. */
  external_verified: boolean
  /** Per-line industry tag for skill-pool routing (`042`). */
  industry_tag: string | null
  /** How matched receptionists are dialed — sequential or simultaneous (`042`). */
  routing_pool_mode: "sequential" | "simultaneous"
  /** Line-level admin inbound PSTN override (`073`). */
  admin_routing_override_phone?: string | null
  /** Workspace-level override when line override is unset (`073`). */
  organization_admin_routing_override_phone?: string | null
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

/** Unread porting alert joined to workspace order + phone for the notification bell. */
export interface PortingNotificationEnriched extends PortingNotification {
  workspace_port_order_id: string | null
  phone_number: string | null
}

/** Owner porting drawer — order + thread + pipeline for GET /api/porting/orders/[id]/desk. */
export interface PortingConversationItem {
  id: string
  source: "webhook" | "telnyx_comment"
  author: "porting_desk" | "customer" | "system" | "carrier"
  title: string
  body: string
  created_at: string
  is_new: boolean
}

export interface OwnerPortingDeskDetail {
  order: PortingOrder
  notifications: PortingNotification[]
  /** Merged Telnyx API comments + webhook notifications (preferred for UI). */
  conversation: PortingConversationItem[]
  pipeline_steps: { key: string; label: string; state: "complete" | "current" | "upcoming" | "failed" }[]
  unread_count: number
  banner_phase: "in_progress" | "action_needed" | "rejected"
  /** True when UI should show PIN field + block chat-only resubmit. */
  pin_correction_required: boolean
  /** True when PIN is on file but Telnyx still shows a PIN exception (awaiting re-review). */
  pin_saved_pending_review: boolean
}

/** Admin porting desk — order detail bundle for GET /api/admin/porting/[id]. */
export interface AdminPortingDeskDetail {
  order: PortingOrder
  notifications: PortingNotification[]
  telnyx_comments: { id: string; body: string; user_type: string; created_at: string }[]
  telnyx_live_status: string | null
  telnyx_status_label: string
  pipeline_steps: { key: string; label: string; state: "complete" | "current" | "upcoming" | "failed" }[]
  action_alerts: PortingNotification[]
}

/** POST body for admin porting corrections. */
export interface AdminPortingCorrectionRequest {
  account_number?: string
  pin?: string
  street_address?: string
  city?: string
  state?: string
  postal_code?: string
  entity_name?: string
  authorized_person?: string
  loa_base64?: string
  loa_filename?: string
  invoice_base64?: string
  invoice_filename?: string
  carrier_comment?: string
}

// --- Call Logs ---
export type CallType = "incoming" | "outgoing" | "missed" | "voicemail" | "manual_intake"

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
  /** Operator SMS outcome when scripts/059 is applied (BOOKED, PENDING_TIME, …). */
  disposition?: string | null
  created_at: string
}

/** Intake + scheduling summary attached to a call row on Live Activity. */
export interface CallActivityContext {
  intakeAction: string
  intakeDetail: string | null
  scheduleLabel: string | null
  scheduleAt: string | null
  leadId: string | null
  callerScheduleHint: string | null
  callerPoolCount: number
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
  /** Caller hears greeting before connect vs straight ring (`081`). */
  inbound_caller_greeting_enabled?: boolean
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
