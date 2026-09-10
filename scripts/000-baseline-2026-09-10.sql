--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (32e7196)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_settings (
    user_id uuid NOT NULL,
    presence_status text DEFAULT 'AVAILABLE'::text NOT NULL,
    presence_closed_manual boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    on_job_greeting_text text DEFAULT 'Thanks for calling Key Squad. We''re actively on a live lockout service right now, but we are open. Press 1 to get our next open dispatch slot text straight to your device, or stay on the line.'::text NOT NULL,
    closed_greeting_text text DEFAULT 'Thanks for calling Key Squad. Our mobile technicians are currently off-duty for the evening. You can book a priority appointment slot for tomorrow morning by pressing 1, or leave a voicemail.'::text NOT NULL,
    ivr_bypass_code text,
    ivr_voice_engine_model text DEFAULT 'en-US-Standard-C'::text NOT NULL,
    holiday_override_start timestamp with time zone,
    holiday_override_end timestamp with time zone,
    holiday_greeting_text text,
    ivr_capacity_threshold integer DEFAULT 5 NOT NULL,
    smart_busy_enabled boolean DEFAULT false NOT NULL,
    sales_tax_enabled_default boolean DEFAULT true NOT NULL,
    sales_tax_rate_percent numeric(5,2) DEFAULT 6.00 NOT NULL,
    hold_music_url text,
    hold_max_wait_secs integer,
    hold_reprompt_secs integer,
    hours_schedule_enabled boolean DEFAULT false NOT NULL,
    hours_timezone text DEFAULT 'America/New_York'::text NOT NULL,
    CONSTRAINT account_settings_presence_status_check CHECK ((presence_status = ANY (ARRAY['AVAILABLE'::text, 'ON_JOB'::text, 'CLOSED'::text])))
);


--
-- Name: account_weekly_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_weekly_hours (
    user_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    start_time text DEFAULT '09:00'::text NOT NULL,
    end_time text DEFAULT '17:00'::text NOT NULL,
    CONSTRAINT account_weekly_hours_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: admin_support_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_support_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_email_id text NOT NULL,
    message_id text,
    from_email text NOT NULL,
    from_name text,
    to_email text DEFAULT ''::text NOT NULL,
    to_emails text[] DEFAULT '{}'::text[] NOT NULL,
    received_for text[] DEFAULT '{}'::text[] NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    text_body text,
    html_body text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    provider_meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: affiliate_locksmiths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.affiliate_locksmiths (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    name text NOT NULL,
    phone_e164 text NOT NULL,
    webhook_url text,
    commission_cents integer DEFAULT 5000 NOT NULL,
    notes text,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT affiliate_locksmiths_commission_cents_check CHECK ((commission_cents >= 0))
);


--
-- Name: agreement_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agreement_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid,
    kind text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    body_md text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agreement_templates_kind_check CHECK ((kind = ANY (ARRAY['W2_OFFER'::text, 'CONTRACTOR_AGREEMENT'::text, 'PAY_ADDENDUM'::text])))
);


--
-- Name: ai_assistant_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_assistant_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_conversation_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversation_state (
    call_sid text NOT NULL,
    user_id uuid NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    caller_e164 text,
    intent_slug text,
    collected jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary text,
    sms_sent boolean DEFAULT false NOT NULL,
    sms_error text,
    vapi_call_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_tech_id uuid,
    job_status text,
    disposition text,
    dispatch_status text,
    is_salvageable boolean DEFAULT false NOT NULL,
    scheduled_at timestamp with time zone,
    organization_id uuid,
    job_address_full text,
    job_address_street_number text,
    job_address_route text,
    job_address_locality text,
    job_address_postal_code text,
    job_address_admin_area text,
    calculated_total_cents integer,
    final_booked_total_cents integer,
    is_price_overridden boolean DEFAULT false NOT NULL,
    customer_id uuid,
    source_call_log_id uuid,
    booked_by_receptionist_id uuid,
    booking_attribution_inferred boolean DEFAULT false NOT NULL,
    accepted_at timestamp with time zone,
    payment_pending_remote boolean DEFAULT false NOT NULL
);


--
-- Name: amber_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amber_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    event_type text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amber_inbound_seen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amber_inbound_seen (
    telnyx_message_id text NOT NULL,
    seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amber_job_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amber_job_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    amber_workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    lead_id uuid NOT NULL,
    customer_phone text NOT NULL,
    customer_name text,
    job_label text,
    address_snippet text,
    urgency text DEFAULT 'window'::text NOT NULL,
    state text DEFAULT 'awaiting_instruction'::text NOT NULL,
    draft_body text,
    draft_expires_at timestamp with time zone,
    last_instruction text,
    pinged_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amber_mobile_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amber_mobile_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    mobile_e164 text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: amber_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amber_workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    phone_number_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    owner_mobile_e164 text,
    owner_mobile_verified_at timestamp with time zone,
    presence_available_at timestamp with time zone,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    coworker_paused_at timestamp with time zone
);


--
-- Name: app_improvements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_improvements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    category text DEFAULT 'general'::text NOT NULL,
    status text DEFAULT 'backlog'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    source text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid,
    actor_user_id uuid,
    actor_role text NOT NULL,
    event_type text NOT NULL,
    entity_type text,
    entity_id text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    delta_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL,
    reason text NOT NULL,
    reference text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: booking_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    business_line text,
    customer_phone text,
    customer_name text,
    scheduled_at timestamp with time zone NOT NULL,
    amount_cents integer DEFAULT 2500 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    stripe_checkout_session_id text,
    lead_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: booking_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    business_line text NOT NULL,
    caller_phone text,
    source text DEFAULT 'ivr'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    short_code text
);


--
-- Name: call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    from_number text NOT NULL,
    to_number text NOT NULL,
    caller_name text,
    call_type text DEFAULT 'incoming'::text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL,
    routed_to_receptionist_id uuid,
    routed_to_name text,
    has_recording boolean DEFAULT false NOT NULL,
    recording_url text,
    recording_duration_seconds integer,
    created_at timestamp with time zone DEFAULT now(),
    provider_call_sid text,
    first_ring_at timestamp with time zone,
    answered_at timestamp with time zone,
    ended_at timestamp with time zone,
    setup_duration_ms integer,
    post_dial_delay_ms integer,
    disposition text,
    internal_notes text,
    ivr_action_completed boolean DEFAULT false NOT NULL,
    owner_intake_dismissed_at timestamp with time zone,
    sms_follow_up_status text DEFAULT 'none'::text NOT NULL,
    sms_follow_up_last_at timestamp with time zone,
    sms_follow_up_preview text,
    CONSTRAINT call_logs_call_type_check CHECK ((call_type = ANY (ARRAY['incoming'::text, 'outgoing'::text, 'missed'::text, 'voicemail'::text]))),
    CONSTRAINT call_logs_sms_follow_up_status_check CHECK ((sms_follow_up_status = ANY (ARRAY['none'::text, 'awaiting_reply'::text, 'replied'::text, 'resolved'::text])))
);


--
-- Name: call_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    call_control_id text NOT NULL,
    call_session_id text,
    call_log_id uuid,
    caller_e164 text,
    business_line_e164 text,
    queue_name text NOT NULL,
    status text DEFAULT 'waiting'::text NOT NULL,
    position_hint integer,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_by_user_id uuid,
    answered_at timestamp with time zone,
    left_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: certifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code_identifier text NOT NULL,
    module_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: collect_pay_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collect_pay_links (
    token text NOT NULL,
    stripe_session_id text,
    owner_user_id uuid,
    acting_user_id uuid,
    job_id text,
    charge_cents integer DEFAULT 0 NOT NULL,
    business_label text DEFAULT ''::text NOT NULL,
    customer_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    subtotal_cents integer DEFAULT 0 NOT NULL,
    tax_cents integer DEFAULT 0 NOT NULL,
    tip_cents integer DEFAULT 0 NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    line_summary text DEFAULT ''::text NOT NULL,
    customer_phone text DEFAULT ''::text NOT NULL,
    customer_email text DEFAULT ''::text NOT NULL,
    tech_user_id uuid,
    receipt_sent_at timestamp with time zone
);


--
-- Name: compensation_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compensation_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    organization_id uuid,
    worker_role text NOT NULL,
    receptionist_id uuid,
    field_technician_id uuid,
    worker_user_id uuid,
    employment_type text DEFAULT 'UNSPECIFIED'::text NOT NULL,
    components jsonb DEFAULT '[]'::jsonb NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    superseded_by uuid,
    agreement_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT compensation_plans_employment_type_check CHECK ((employment_type = ANY (ARRAY['W2_EMPLOYEE'::text, 'CONTRACTOR_1099'::text, 'UNSPECIFIED'::text]))),
    CONSTRAINT compensation_plans_window_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from))),
    CONSTRAINT compensation_plans_worker_ref_check CHECK ((((worker_role = 'receptionist'::text) AND (receptionist_id IS NOT NULL) AND (field_technician_id IS NULL)) OR ((worker_role = 'field_tech'::text) AND (field_technician_id IS NOT NULL) AND (receptionist_id IS NULL)))),
    CONSTRAINT compensation_plans_worker_role_check CHECK ((worker_role = ANY (ARRAY['receptionist'::text, 'field_tech'::text])))
);


--
-- Name: customer_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    kind text DEFAULT ''::text NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    install_year text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    year text DEFAULT ''::text NOT NULL,
    make text DEFAULT ''::text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    vin text DEFAULT ''::text NOT NULL,
    fcc_id text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone_e164 text NOT NULL,
    display_name text DEFAULT ''::text NOT NULL,
    company_name text DEFAULT ''::text NOT NULL,
    address_line1 text DEFAULT ''::text NOT NULL,
    address_line2 text DEFAULT ''::text NOT NULL,
    city text DEFAULT ''::text NOT NULL,
    region text DEFAULT ''::text NOT NULL,
    postal_code text DEFAULT ''::text NOT NULL,
    country text DEFAULT 'US'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    source_last_call_log_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text DEFAULT ''::text NOT NULL
);


--
-- Name: earnings_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.earnings_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    organization_id uuid,
    worker_role text NOT NULL,
    receptionist_id uuid,
    field_technician_id uuid,
    worker_user_id uuid,
    plan_id uuid,
    component_kind text NOT NULL,
    source_kind text NOT NULL,
    source_id uuid,
    amount_cents integer NOT NULL,
    quantity numeric(14,4) DEFAULT 0 NOT NULL,
    rate_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    earned_at timestamp with time zone NOT NULL,
    pay_period_id uuid,
    reversed_by uuid,
    reversal_of uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT earnings_ledger_component_kind_check CHECK ((component_kind = ANY (ARRAY['TIME'::text, 'PER_EVENT'::text, 'COMMISSION'::text, 'MINIMUM_WAGE_TOPUP'::text, 'PAYOUT'::text]))),
    CONSTRAINT earnings_ledger_source_kind_check CHECK ((source_kind = ANY (ARRAY['CALL'::text, 'JOB'::text, 'SHIFT'::text, 'ADJUSTMENT'::text, 'PAYOUT'::text]))),
    CONSTRAINT earnings_ledger_worker_ref_check CHECK ((((worker_role = 'receptionist'::text) AND (receptionist_id IS NOT NULL) AND (field_technician_id IS NULL)) OR ((worker_role = 'field_tech'::text) AND (field_technician_id IS NOT NULL) AND (receptionist_id IS NULL)))),
    CONSTRAINT earnings_ledger_worker_role_check CHECK ((worker_role = ANY (ARRAY['receptionist'::text, 'field_tech'::text])))
);


--
-- Name: feedback_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    category text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feedback_submissions_category_check CHECK ((category = ANY (ARRAY['issue'::text, 'feature'::text, 'billing'::text, 'other'::text]))),
    CONSTRAINT feedback_submissions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'triaged'::text, 'closed'::text])))
);


--
-- Name: field_technicians; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_technicians (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    portal_user_id uuid,
    name text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid,
    capabilities jsonb DEFAULT '{"job_pool": false, "view_earnings": false, "collect_payment": false, "customer_contact": false}'::jsonb NOT NULL,
    address text
);


--
-- Name: intake_book_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intake_book_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    caller_phone text NOT NULL,
    business_line text,
    call_log_id text,
    fee_mode text DEFAULT 'none'::text NOT NULL,
    quote_cents integer DEFAULT 0 NOT NULL,
    operator_note text DEFAULT ''::text NOT NULL,
    pay_token text,
    job_id text,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    CONSTRAINT intake_book_links_fee_mode_check CHECK ((fee_mode = ANY (ARRAY['none'::text, 'service_call'::text, 'full_quote'::text])))
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target text NOT NULL,
    type text DEFAULT 'EMAIL'::text NOT NULL,
    token text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT invitations_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'EXPIRED'::text]))),
    CONSTRAINT invitations_type_check CHECK ((type = ANY (ARRAY['EMAIL'::text, 'SMS'::text])))
);


--
-- Name: job_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid,
    owner_user_id uuid NOT NULL,
    tech_user_id uuid,
    customer_name text,
    customer_phone text,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal_cents integer DEFAULT 0 NOT NULL,
    tax_cents integer DEFAULT 0 NOT NULL,
    total_cents integer DEFAULT 0 NOT NULL,
    payment_status text DEFAULT 'unpaid'::text NOT NULL,
    payment_method text,
    card_last4 text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone
);


--
-- Name: job_photo_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_photo_tokens (
    id text NOT NULL,
    owner_user_id uuid NOT NULL,
    call_log_id text,
    customer_phone text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '04:00:00'::interval) NOT NULL,
    ticket_status text DEFAULT 'awaiting_photos'::text NOT NULL,
    operator_alert_sent_at timestamp with time zone,
    customer_name text,
    vehicle_vin text,
    special_notes text,
    vehicle_year text,
    vehicle_make text,
    vehicle_model text,
    vehicle_trim text,
    rescue_submitted_at timestamp with time zone,
    verify_on_arrival boolean DEFAULT false NOT NULL,
    vin_unavailable boolean DEFAULT false NOT NULL,
    CONSTRAINT job_photo_tokens_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'uploaded'::text, 'expired'::text]))),
    CONSTRAINT job_photo_tokens_ticket_status_check CHECK ((ticket_status = ANY (ARRAY['awaiting_photos'::text, 'pending_info'::text, 'info_received'::text, 'resolved'::text])))
);


--
-- Name: job_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_id text NOT NULL,
    owner_user_id uuid NOT NULL,
    call_log_id text,
    mime_type text DEFAULT 'image/jpeg'::text NOT NULL,
    file_name text,
    data_base64 text NOT NULL,
    byte_size integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text DEFAULT 'damage'::text NOT NULL,
    CONSTRAINT job_photos_category_check CHECK ((category = ANY (ARRAY['damage'::text, 'id_verification'::text, 'other'::text])))
);


--
-- Name: job_record_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_record_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    customer_id uuid,
    job_id uuid,
    amount_cents integer NOT NULL,
    payment_method text DEFAULT 'VENMO'::text NOT NULL,
    payment_note text DEFAULT ''::text NOT NULL,
    customer_name text DEFAULT ''::text NOT NULL,
    customer_email text DEFAULT ''::text NOT NULL,
    customer_phone text DEFAULT ''::text NOT NULL,
    service_label text DEFAULT ''::text NOT NULL,
    vehicle_label text DEFAULT ''::text NOT NULL,
    vehicle_vin text DEFAULT ''::text NOT NULL,
    address_line1 text DEFAULT ''::text NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    receipt_token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    invoice_number text DEFAULT ''::text NOT NULL,
    delivery_status text DEFAULT 'pending'::text NOT NULL,
    channels_requested text DEFAULT ''::text NOT NULL,
    email_sent_at timestamp with time zone,
    sms_sent_at timestamp with time zone,
    email_error text DEFAULT ''::text NOT NULL,
    sms_error text DEFAULT ''::text NOT NULL,
    last_sent_at timestamp with time zone,
    revision integer DEFAULT 1 NOT NULL,
    parent_invoice_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_record_invoices_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT job_record_invoices_payment_method_check CHECK ((payment_method = ANY (ARRAY['VENMO'::text, 'CASH'::text, 'OTHER'::text, 'EXTERNAL'::text])))
);


--
-- Name: key_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.key_inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    sku text NOT NULL,
    fcc_id text DEFAULT ''::text NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    compatible_vehicles jsonb DEFAULT '[]'::jsonb NOT NULL,
    van1_quantity integer DEFAULT 0 NOT NULL,
    van2_quantity integer DEFAULT 0 NOT NULL,
    shop_quantity integer DEFAULT 0 NOT NULL,
    minimum_stock_alert integer DEFAULT 2 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_specialty boolean DEFAULT false NOT NULL,
    frequency text DEFAULT ''::text NOT NULL,
    button_count integer DEFAULT 0 NOT NULL,
    ti_sku text,
    alt_sku text,
    supplier_name text DEFAULT 'Transponder Island'::text NOT NULL,
    image_url text,
    image_data_base64 text,
    image_mime_type text,
    product_title text,
    product_url text,
    cross_ref_ti_sku text,
    CONSTRAINT key_inventory_minimum_stock_alert_check CHECK ((minimum_stock_alert >= 0)),
    CONSTRAINT key_inventory_shop_quantity_check CHECK ((shop_quantity >= 0)),
    CONSTRAINT key_inventory_van1_quantity_check CHECK ((van1_quantity >= 0)),
    CONSTRAINT key_inventory_van2_quantity_check CHECK ((van2_quantity >= 0))
);


--
-- Name: key_inventory_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.key_inventory_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    key_inventory_id uuid NOT NULL,
    location text NOT NULL,
    delta integer NOT NULL,
    balance_after integer NOT NULL,
    reason text NOT NULL,
    actor_role text NOT NULL,
    actor_user_id uuid,
    actor_label text DEFAULT ''::text NOT NULL,
    reorder_request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    job_id uuid,
    CONSTRAINT key_inventory_ledger_actor_role_check CHECK ((actor_role = ANY (ARRAY['owner'::text, 'field_tech'::text]))),
    CONSTRAINT key_inventory_ledger_location_check CHECK ((location = ANY (ARRAY['van1'::text, 'van2'::text, 'shop'::text]))),
    CONSTRAINT key_inventory_ledger_reason_check CHECK ((reason = ANY (ARRAY['scan_adjust'::text, 'new_sku_initial'::text, 'reorder_received'::text, 'job_use'::text])))
);


--
-- Name: key_reorder_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.key_reorder_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    organization_id uuid,
    key_inventory_id uuid,
    ti_sku text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    fcc_id text DEFAULT ''::text NOT NULL,
    product_url text DEFAULT ''::text NOT NULL,
    image_url text,
    vehicle_year text,
    vehicle_make text,
    vehicle_model text,
    quantity integer DEFAULT 1 NOT NULL,
    requested_by_role text NOT NULL,
    requested_by_user_id uuid,
    requested_by_label text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by_user_id uuid,
    decided_at timestamp with time zone,
    denial_reason text,
    ordered_at timestamp with time zone,
    received_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT key_reorder_requests_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT key_reorder_requests_requested_by_role_check CHECK ((requested_by_role = ANY (ARRAY['owner'::text, 'field_tech'::text]))),
    CONSTRAINT key_reorder_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'ordered'::text, 'received'::text, 'cancelled'::text])))
);


--
-- Name: latest_attention_sms_sent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.latest_attention_sms_sent (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    dedupe_key text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT latest_attention_sms_sent_event_check CHECK ((event_type = ANY (ARRAY['replied'::text, 'job_finished'::text, 'book_form'::text])))
);


--
-- Name: live_gps_locate_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_gps_locate_tokens (
    id text NOT NULL,
    owner_user_id uuid NOT NULL,
    call_log_id text,
    customer_phone text,
    latitude double precision,
    longitude double precision,
    formatted_address text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    shared_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '02:00:00'::interval) NOT NULL,
    CONSTRAINT live_gps_locate_tokens_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'shared'::text, 'expired'::text])))
);


--
-- Name: lost_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lost_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    call_log_id text,
    phone_number text NOT NULL,
    last_quoted_price_cents integer,
    failure_reason text NOT NULL,
    status text DEFAULT 'lost_lead'::text NOT NULL,
    vehicle_year text,
    vehicle_make text,
    vehicle_model text,
    service_type text,
    collected jsonb DEFAULT '{}'::jsonb NOT NULL,
    recovery_sms_sent_at timestamp with time zone,
    recovery_sms_body text,
    recovery_sms_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messaging_10dlc_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messaging_10dlc_registrations (
    user_id uuid NOT NULL,
    entity_type text,
    legal_company_name text,
    display_name text,
    ein text,
    vertical text,
    website text,
    contact_first_name text,
    contact_last_name text,
    email text,
    phone text,
    street text,
    city text,
    state text,
    postal_code text,
    country text DEFAULT 'US'::text,
    use_case text,
    campaign_description text,
    sample_message_1 text,
    sample_message_2 text,
    message_flow text,
    brand_id text,
    campaign_id text,
    assigned_number text,
    status text DEFAULT 'draft'::text NOT NULL,
    status_detail text,
    fee_cents integer DEFAULT 0 NOT NULL,
    fee_paid boolean DEFAULT false NOT NULL,
    stripe_session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onboarding_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_profiles (
    user_id uuid NOT NULL,
    reserved_number text,
    reserved_number_display text,
    reserved_number_method text,
    port_carrier text,
    fallback_type text,
    trade_category text,
    opening_line text,
    has_active_subscription boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    has_billing_method boolean DEFAULT false NOT NULL,
    billing_cycle_start timestamp with time zone,
    stripe_subscription_id text,
    billing_cycle_end timestamp with time zone,
    stripe_customer_id text,
    subscription_tier text DEFAULT 'free_trial'::text NOT NULL,
    carrier_credit numeric(10,2) DEFAULT 0.00 NOT NULL,
    total_calls_routed integer DEFAULT 0 NOT NULL,
    total_minutes_used numeric(10,2) DEFAULT 0.00 NOT NULL,
    account_status text DEFAULT 'active'::text NOT NULL,
    custom_routing_note text,
    sms_leads_enabled boolean DEFAULT false NOT NULL,
    notification_phone text,
    dispatch_sms_phone text,
    low_balance_notified boolean DEFAULT false NOT NULL,
    email_recordings_enabled boolean DEFAULT false NOT NULL,
    business_hours text,
    service_rules text,
    sms_booking_enabled boolean DEFAULT false NOT NULL,
    sms_route_enabled boolean DEFAULT false NOT NULL,
    sms_review_enabled boolean DEFAULT false NOT NULL,
    sms_booking_template text,
    sms_route_template text,
    sms_review_template text,
    google_review_url text,
    merchant_provider text,
    merchant_account_label text,
    merchant_configured boolean DEFAULT false NOT NULL,
    routing_instructions text,
    feature_flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    admin_routing_override_phone character varying(20) DEFAULT NULL::character varying,
    sms_custom_snippets jsonb DEFAULT '[]'::jsonb NOT NULL,
    sms_status_templates jsonb DEFAULT '{}'::jsonb NOT NULL,
    sms_latest_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT onboarding_profiles_fallback_type_check CHECK (((fallback_type IS NULL) OR (fallback_type = ANY (ARRAY['ai'::text, 'voicemail'::text])))),
    CONSTRAINT onboarding_profiles_reserved_number_method_check CHECK (((reserved_number_method IS NULL) OR (reserved_number_method = ANY (ARRAY['buy'::text, 'port'::text])))),
    CONSTRAINT onboarding_profiles_subscription_tier_check CHECK ((subscription_tier = ANY (ARRAY['free_trial'::text, 'starter'::text, 'professional'::text, 'business'::text])))
);


--
-- Name: operator_dashboard_heartbeats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operator_dashboard_heartbeats (
    user_id uuid NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sms_registration_status text,
    admin_routing_override_phone text
);


--
-- Name: payment_receipt_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_receipt_tokens (
    token text NOT NULL,
    owner_user_id uuid NOT NULL,
    stripe_payment_intent_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_slips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_slips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stripe_payment_intent_id text NOT NULL,
    tip_cents integer DEFAULT 0 NOT NULL,
    tip_payment_intent_id text,
    signature_png text,
    signed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_slips_tip_nonneg CHECK ((tip_cents >= 0))
);


--
-- Name: payout_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receptionist_id uuid NOT NULL,
    amount_usd numeric(12,2) DEFAULT 0 NOT NULL,
    minutes_paid numeric(12,2) DEFAULT 0 NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pending_call_review_sms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_call_review_sms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    call_sid text NOT NULL,
    caller_e164 text NOT NULL,
    check_after timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    skip_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT pending_call_review_sms_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))
);


--
-- Name: pending_sms_dispositions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_sms_dispositions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    call_log_id uuid,
    provider_call_sid text NOT NULL,
    receptionist_id uuid,
    receptionist_name text,
    receptionist_phone_e164 text NOT NULL,
    caller_number text,
    business_name text,
    status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone
);


--
-- Name: phone_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_numbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    number text NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    label text DEFAULT 'Main Line'::text NOT NULL,
    type text DEFAULT 'local'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    provider_number_sid text,
    number_digits text GENERATED ALWAYS AS (regexp_replace(number, '\D'::text, ''::text, 'g'::text)) STORED,
    inbound_dial_e164 text,
    inbound_receptionist_id uuid,
    inbound_receptionist_name text,
    inbound_fallback_type text,
    inbound_ring_timeout_seconds integer,
    inbound_account_status text DEFAULT 'active'::text,
    inbound_ai_ring_owner_first boolean DEFAULT false,
    inbound_routing_updated_at timestamp with time zone,
    industry_tag text,
    routing_pool_mode text DEFAULT 'sequential'::text NOT NULL,
    port_in_request_sid text DEFAULT ''::text,
    inbound_routing_endpoint text,
    inbound_sip_username text,
    organization_id uuid,
    source_provider text DEFAULT 'telnyx'::text NOT NULL,
    external_verified boolean DEFAULT false NOT NULL,
    admin_routing_override_phone text,
    inbound_caller_greeting_enabled boolean DEFAULT true NOT NULL,
    ivr_greeting_text text,
    ivr_option1_action text,
    ivr_option2_action text,
    ivr_menu_enabled boolean DEFAULT false NOT NULL,
    forward_original_caller_id boolean DEFAULT false NOT NULL,
    is_amber_control boolean DEFAULT false NOT NULL,
    CONSTRAINT phone_numbers_routing_pool_mode_check CHECK ((routing_pool_mode = ANY (ARRAY['sequential'::text, 'simultaneous'::text]))),
    CONSTRAINT phone_numbers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'porting'::text, 'released'::text]))),
    CONSTRAINT phone_numbers_type_check CHECK ((type = ANY (ARRAY['local'::text, 'toll-free'::text])))
);


--
-- Name: platform_health_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_health_snapshots (
    check_name text NOT NULL,
    status text NOT NULL,
    last_error_at timestamp with time zone,
    last_ok_at timestamp with time zone,
    last_alerted_at timestamp with time zone,
    last_recovery_alerted_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_health_snapshots_check_name_chk CHECK ((check_name = ANY (ARRAY['neon'::text, 'telnyx'::text]))),
    CONSTRAINT platform_health_snapshots_status_chk CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text, 'unconfigured'::text])))
);


--
-- Name: playing_with_neon; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playing_with_neon (
    id integer NOT NULL,
    name text NOT NULL,
    value real
);


--
-- Name: playing_with_neon_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.playing_with_neon_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: playing_with_neon_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.playing_with_neon_id_seq OWNED BY public.playing_with_neon.id;


--
-- Name: porting_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porting_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    telnyx_event_id text NOT NULL,
    porting_order_id text,
    event_type text DEFAULT ''::text NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    raw_payload jsonb,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid
);


--
-- Name: porting_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.porting_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    organization_id uuid,
    phone_number text NOT NULL,
    current_carrier text DEFAULT ''::text NOT NULL,
    account_number text DEFAULT ''::text NOT NULL,
    pin_or_sid text,
    status text DEFAULT 'pending'::text NOT NULL,
    telnyx_order_id text,
    telnyx_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    carrier_rejection_reason text,
    CONSTRAINT porting_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'rejected'::text, 'action_required'::text, 'pending_info'::text, 'submitted'::text, 'pending_carrier_review'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id text NOT NULL,
    business_name text,
    reserved_number text,
    fallback_type text DEFAULT 'ai'::text,
    trade_category text DEFAULT 'general'::text,
    opening_line text,
    has_active_subscription boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: receptionist_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receptionist_badges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    certification_id uuid NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    active_toggle boolean DEFAULT true NOT NULL,
    earned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT receptionist_badges_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'certified'::text])))
);


--
-- Name: receptionists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receptionists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    phone text NOT NULL,
    initials text DEFAULT ''::text NOT NULL,
    color text DEFAULT 'bg-primary'::text NOT NULL,
    rate_per_minute numeric(6,4) DEFAULT 0.25 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    pay_mode text DEFAULT 'PER_MINUTE'::text NOT NULL,
    flat_rate_usd numeric(6,2) DEFAULT 2.50 NOT NULL,
    portal_user_id uuid,
    skills text[] DEFAULT '{}'::text[] NOT NULL,
    sip_username text,
    routing_endpoint text DEFAULT 'CELL'::text NOT NULL,
    sip_credential_id text,
    is_mobile_operator boolean DEFAULT false NOT NULL,
    backup_phone_number text,
    assigned_workspaces jsonb DEFAULT '[]'::jsonb NOT NULL,
    capabilities jsonb DEFAULT '{"full_vehicle_key_catalog": false}'::jsonb NOT NULL,
    address text,
    CONSTRAINT receptionists_pay_mode_check CHECK ((pay_mode = ANY (ARRAY['FLAT_RATE'::text, 'PER_MINUTE'::text]))),
    CONSTRAINT receptionists_routing_endpoint_check CHECK ((routing_endpoint = ANY (ARRAY['WEB'::text, 'CELL'::text])))
);


--
-- Name: review_link_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_link_tokens (
    token text NOT NULL,
    owner_user_id uuid NOT NULL,
    lead_id uuid,
    destination_url text NOT NULL,
    customer_phone text,
    click_count integer DEFAULT 0 NOT NULL,
    first_clicked_at timestamp with time zone,
    last_clicked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: routing_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    selected_receptionist_id uuid,
    fallback_type text DEFAULT 'owner'::text NOT NULL,
    ai_greeting text DEFAULT 'Thank you for calling. Our team is currently unavailable. I can take a message, provide our business hours, or help direct your call. How can I help you?'::text NOT NULL,
    ring_timeout_seconds integer DEFAULT 20 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    business_number text,
    ai_ring_owner_first boolean DEFAULT false NOT NULL,
    industry_tag text,
    routing_strategy text DEFAULT 'private_only'::text NOT NULL,
    allow_lyncr_network_fallback boolean DEFAULT false NOT NULL,
    private_ring_timeout_seconds integer DEFAULT 15 NOT NULL,
    inbound_caller_greeting_enabled boolean DEFAULT true NOT NULL,
    ivr_greeting_text text DEFAULT 'Thanks for calling Key Squad 5-0-2. We are fully booked today. Press 1 to receive a secure booking link by text. Press 2 to reserve our earliest priority slot tomorrow morning.'::text NOT NULL,
    ivr_option1_action text DEFAULT 'sms_link'::text NOT NULL,
    ivr_option2_action text DEFAULT 'live_booking'::text NOT NULL,
    ivr_menu_enabled boolean DEFAULT false NOT NULL,
    active_routing_mode text DEFAULT 'your_phone'::text NOT NULL,
    custom_routing_phone text,
    forward_original_caller_id boolean DEFAULT false NOT NULL,
    oncall_technician_id uuid,
    CONSTRAINT routing_config_fallback_type_check CHECK ((fallback_type = ANY (ARRAY['owner'::text, 'ai'::text, 'voicemail'::text, 'hold'::text]))),
    CONSTRAINT routing_config_routing_strategy_check CHECK ((routing_strategy = ANY (ARRAY['private_only'::text, 'lyncr_only'::text, 'hybrid_fallback'::text])))
);


--
-- Name: schedule_blockouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_blockouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    date text NOT NULL,
    is_full_day boolean DEFAULT false NOT NULL,
    start_time text,
    end_time text,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schedule_blockouts_date_format CHECK ((date ~ '^\d{4}-\d{2}-\d{2}$'::text)),
    CONSTRAINT schedule_blockouts_partial_times CHECK (((is_full_day = true) OR ((start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (start_time < end_time))))
);


--
-- Name: scheduled_sms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_sms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    lead_id uuid,
    to_e164 text NOT NULL,
    body text NOT NULL,
    phase text DEFAULT 'review'::text NOT NULL,
    send_after timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone
);


--
-- Name: sms_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    owner_user_id uuid NOT NULL,
    phone_number_id uuid,
    direction text NOT NULL,
    from_number text NOT NULL,
    to_number text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    customer_phone text NOT NULL,
    telnyx_message_id text,
    status text DEFAULT 'received'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    failed_at timestamp with time zone,
    delivery_error text,
    call_log_id uuid,
    CONSTRAINT sms_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))
);


--
-- Name: sms_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    owner_user_id uuid NOT NULL,
    legal_business_name text NOT NULL,
    entity_type text NOT NULL,
    tax_id_ein text,
    street text NOT NULL,
    city text NOT NULL,
    state text NOT NULL,
    postal_code text NOT NULL,
    use_case_description text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sms_registrations_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING_APPROVAL'::text, 'APPROVED'::text, 'REJECTED'::text])))
);


--
-- Name: support_chat_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_chat_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    url text NOT NULL,
    filename text DEFAULT ''::text NOT NULL,
    content_type text DEFAULT 'application/octet-stream'::text NOT NULL,
    size_bytes integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: support_chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    sender_type text NOT NULL,
    sender_user_id uuid,
    body text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_chat_messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['user'::text, 'admin'::text, 'system'::text])))
);


--
-- Name: support_chat_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_chat_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone,
    admin_unread_count integer DEFAULT 0 NOT NULL,
    user_unread_count integer DEFAULT 0 NOT NULL,
    waiting_agent_notice_sent boolean DEFAULT false NOT NULL,
    CONSTRAINT support_chat_threads_status_check CHECK ((status = ANY (ARRAY['open'::text, 'waiting'::text, 'closed'::text])))
);


--
-- Name: team_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text,
    first_name text,
    role text DEFAULT 'receptionist'::text NOT NULL,
    token text NOT NULL,
    payout_rate_usd numeric(6,2) DEFAULT 2.50 NOT NULL,
    invited_by_user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    channel text DEFAULT 'EMAIL'::text NOT NULL,
    phone text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    CONSTRAINT team_invites_channel_check CHECK ((channel = ANY (ARRAY['EMAIL'::text, 'SMS'::text]))),
    CONSTRAINT team_invites_role_check CHECK ((role = ANY (ARRAY['receptionist'::text, 'field_tech'::text]))),
    CONSTRAINT team_invites_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'EXPIRED'::text])))
);


--
-- Name: telnyx_ai_incoming_handoff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telnyx_ai_incoming_handoff (
    call_sid text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    incoming_hits integer DEFAULT 1 NOT NULL
);


--
-- Name: telnyx_call_leg_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telnyx_call_leg_links (
    inbound_call_control_id text NOT NULL,
    outbound_call_control_id text NOT NULL,
    call_session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: telnyx_inbound_dial_caller_done; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telnyx_inbound_dial_caller_done (
    call_sid text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ti_supplier_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ti_supplier_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ti_sku text DEFAULT ''::text NOT NULL,
    cross_ref_ti_sku text,
    title text DEFAULT ''::text NOT NULL,
    fcc_id text DEFAULT ''::text NOT NULL,
    frequency text DEFAULT ''::text NOT NULL,
    button_count integer DEFAULT 0 NOT NULL,
    image_url text,
    product_url text NOT NULL,
    scrape_error text,
    scraped_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ti_supplier_catalog_button_count_check CHECK ((button_count >= 0))
);


--
-- Name: user_ai_intake; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_ai_intake (
    user_id uuid NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    business_name text DEFAULT ''::text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    vapi_assistant_id text,
    telnyx_ai_assistant_id text,
    credit_balance_cents bigint DEFAULT 0 NOT NULL,
    billing_plan text DEFAULT 'trial'::text NOT NULL,
    is_platform_admin boolean DEFAULT false NOT NULL,
    account_role text DEFAULT 'owner'::text NOT NULL,
    invitation_token text,
    invitation_expires_at timestamp with time zone,
    invite_status text,
    current_latitude double precision,
    current_longitude double precision,
    tech_status text,
    earned_badges jsonb DEFAULT '[]'::jsonb NOT NULL,
    invite_token text,
    invite_expires_at timestamp without time zone,
    industry text DEFAULT 'generic'::text NOT NULL,
    inbound_receptionist_whisper_enabled boolean DEFAULT true NOT NULL,
    answered_call_customer_popup_enabled boolean DEFAULT true NOT NULL,
    master_toggle_mode text DEFAULT 'admin'::text NOT NULL,
    operator_onboarding_status text,
    timezone text,
    operator_assigned_workspaces jsonb DEFAULT '[]'::jsonb NOT NULL,
    onboarding_otp_code text,
    onboarding_otp_expires_at timestamp with time zone,
    require_deposit boolean DEFAULT false NOT NULL,
    missed_call_textback_enabled boolean DEFAULT true NOT NULL,
    balance numeric(12,2) DEFAULT 0 NOT NULL,
    stripe_connect_account_id text,
    stripe_connect_charges_enabled boolean DEFAULT false NOT NULL,
    stripe_connect_payouts_enabled boolean DEFAULT false NOT NULL,
    stripe_connect_details_submitted boolean DEFAULT false NOT NULL,
    stripe_connect_updated_at timestamp with time zone,
    admin_notification_preferences jsonb DEFAULT '{"sms_platform_health": true, "push_live_inbound_ringing": true, "sms_local_job_assignments": true, "email_daily_revenue_digest": true, "push_operator_dispositions": true, "email_system_fallback_alerts": true, "sms_global_out_of_state_bookings": true}'::jsonb NOT NULL,
    shop_address text,
    shop_latitude double precision,
    shop_longitude double precision,
    platform_grants jsonb DEFAULT '{}'::jsonb NOT NULL,
    contact_email text,
    account_locked boolean DEFAULT false NOT NULL,
    CONSTRAINT users_account_role_check CHECK ((lower(account_role) = ANY (ARRAY['owner'::text, 'receptionist'::text, 'field_tech'::text, 'technician'::text]))),
    CONSTRAINT users_master_toggle_mode_check CHECK ((master_toggle_mode = ANY (ARRAY['tech'::text, 'admin'::text, 'passive'::text]))),
    CONSTRAINT users_operator_onboarding_status_check CHECK (((operator_onboarding_status IS NULL) OR (operator_onboarding_status = ANY (ARRAY['PENDING_INVITE'::text, 'DEVICE_TESTING'::text, 'ACTIVE_READY'::text]))))
);


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    job_id uuid,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    payment_method text NOT NULL,
    stripe_payment_intent_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_phone text,
    customer_name text,
    reverses_transaction_id uuid,
    reversal_reason text,
    owner_user_id uuid,
    entry_type text DEFAULT 'CHARGE'::text NOT NULL,
    CONSTRAINT wallet_transactions_entry_type_check CHECK ((entry_type = ANY (ARRAY['CHARGE'::text, 'REVERSAL'::text, 'PAYOUT'::text, 'FEE'::text]))),
    CONSTRAINT wallet_transactions_payment_method_check CHECK ((payment_method = ANY (ARRAY['TAP_TO_PAY'::text, 'MANUAL_CARD'::text, 'CASH'::text, 'PAYOUT'::text]))),
    CONSTRAINT wallet_transactions_reversal_reason_check CHECK (((reversal_reason IS NULL) OR (reversal_reason = ANY (ARRAY['REFUND'::text, 'DISPUTE'::text, 'DISPUTE_WON'::text])))),
    CONSTRAINT wallet_transactions_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'COMPLETED'::text, 'FAILED'::text])))
);


--
-- Name: work_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    organization_id uuid,
    worker_role text NOT NULL,
    receptionist_id uuid,
    field_technician_id uuid,
    worker_user_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    source text DEFAULT 'AVAILABILITY'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_shifts_source_check CHECK ((source = ANY (ARRAY['AVAILABILITY'::text, 'MANUAL'::text, 'AUTO_CLOSED'::text]))),
    CONSTRAINT work_shifts_window_check CHECK (((ended_at IS NULL) OR (ended_at >= started_at))),
    CONSTRAINT work_shifts_worker_ref_check CHECK ((((worker_role = 'receptionist'::text) AND (receptionist_id IS NOT NULL) AND (field_technician_id IS NULL)) OR ((worker_role = 'field_tech'::text) AND (field_technician_id IS NOT NULL) AND (receptionist_id IS NULL)))),
    CONSTRAINT work_shifts_worker_role_check CHECK ((worker_role = ANY (ARRAY['receptionist'::text, 'field_tech'::text])))
);


--
-- Name: worker_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    organization_id uuid,
    worker_user_id uuid,
    worker_role text NOT NULL,
    receptionist_id uuid,
    field_technician_id uuid,
    invite_id uuid,
    template_id uuid,
    plan_id uuid,
    employment_type text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    rendered_body text NOT NULL,
    body_sha256 text NOT NULL,
    pay_summary text DEFAULT ''::text NOT NULL,
    plan_components jsonb DEFAULT '[]'::jsonb NOT NULL,
    pdf_blob_url text,
    signer_name text,
    signature_type text,
    signature_data text,
    consent_electronic boolean DEFAULT false NOT NULL,
    signed_at timestamp with time zone,
    signed_ip text,
    signed_user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT worker_agreements_employment_type_check CHECK ((employment_type = ANY (ARRAY['W2_EMPLOYEE'::text, 'CONTRACTOR_1099'::text]))),
    CONSTRAINT worker_agreements_signature_type_check CHECK ((signature_type = ANY (ARRAY['TYPED'::text, 'DRAWN'::text]))),
    CONSTRAINT worker_agreements_signed_check CHECK (((status <> 'SIGNED'::text) OR ((signed_at IS NOT NULL) AND (signer_name IS NOT NULL) AND (consent_electronic = true)))),
    CONSTRAINT worker_agreements_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'SIGNED'::text, 'DECLINED'::text, 'VOID'::text]))),
    CONSTRAINT worker_agreements_worker_role_check CHECK ((worker_role = ANY (ARRAY['receptionist'::text, 'field_tech'::text])))
);


--
-- Name: playing_with_neon id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playing_with_neon ALTER COLUMN id SET DEFAULT nextval('public.playing_with_neon_id_seq'::regclass);


--
-- Name: account_settings account_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_settings
    ADD CONSTRAINT account_settings_pkey PRIMARY KEY (user_id);


--
-- Name: account_weekly_hours account_weekly_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_weekly_hours
    ADD CONSTRAINT account_weekly_hours_pkey PRIMARY KEY (user_id, day_of_week);


--
-- Name: admin_support_emails admin_support_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_support_emails
    ADD CONSTRAINT admin_support_emails_pkey PRIMARY KEY (id);


--
-- Name: admin_support_emails admin_support_emails_provider_email_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_support_emails
    ADD CONSTRAINT admin_support_emails_provider_email_id_key UNIQUE (provider_email_id);


--
-- Name: affiliate_locksmiths affiliate_locksmiths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_locksmiths
    ADD CONSTRAINT affiliate_locksmiths_pkey PRIMARY KEY (id);


--
-- Name: agreement_templates agreement_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_templates
    ADD CONSTRAINT agreement_templates_pkey PRIMARY KEY (id);


--
-- Name: ai_assistant_presets ai_assistant_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_assistant_presets
    ADD CONSTRAINT ai_assistant_presets_pkey PRIMARY KEY (id);


--
-- Name: ai_conversation_state ai_conversation_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversation_state
    ADD CONSTRAINT ai_conversation_state_pkey PRIMARY KEY (call_sid);


--
-- Name: ai_leads ai_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_leads
    ADD CONSTRAINT ai_leads_pkey PRIMARY KEY (id);


--
-- Name: amber_audit_events amber_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_audit_events
    ADD CONSTRAINT amber_audit_events_pkey PRIMARY KEY (id);


--
-- Name: amber_inbound_seen amber_inbound_seen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_inbound_seen
    ADD CONSTRAINT amber_inbound_seen_pkey PRIMARY KEY (telnyx_message_id);


--
-- Name: amber_job_threads amber_job_threads_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_job_threads
    ADD CONSTRAINT amber_job_threads_lead_id_key UNIQUE (lead_id);


--
-- Name: amber_job_threads amber_job_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_job_threads
    ADD CONSTRAINT amber_job_threads_pkey PRIMARY KEY (id);


--
-- Name: amber_mobile_verifications amber_mobile_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_mobile_verifications
    ADD CONSTRAINT amber_mobile_verifications_pkey PRIMARY KEY (id);


--
-- Name: amber_workspaces amber_workspaces_phone_number_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_workspaces
    ADD CONSTRAINT amber_workspaces_phone_number_id_key UNIQUE (phone_number_id);


--
-- Name: amber_workspaces amber_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_workspaces
    ADD CONSTRAINT amber_workspaces_pkey PRIMARY KEY (id);


--
-- Name: app_improvements app_improvements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_improvements
    ADD CONSTRAINT app_improvements_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: billing_ledger billing_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_ledger
    ADD CONSTRAINT billing_ledger_pkey PRIMARY KEY (id);


--
-- Name: booking_holds booking_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_holds
    ADD CONSTRAINT booking_holds_pkey PRIMARY KEY (id);


--
-- Name: booking_invites booking_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_invites
    ADD CONSTRAINT booking_invites_pkey PRIMARY KEY (id);


--
-- Name: call_logs call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_pkey PRIMARY KEY (id);


--
-- Name: call_queue call_queue_call_control_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_queue
    ADD CONSTRAINT call_queue_call_control_id_unique UNIQUE (call_control_id);


--
-- Name: call_queue call_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_queue
    ADD CONSTRAINT call_queue_pkey PRIMARY KEY (id);


--
-- Name: certifications certifications_code_identifier_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certifications
    ADD CONSTRAINT certifications_code_identifier_key UNIQUE (code_identifier);


--
-- Name: certifications certifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certifications
    ADD CONSTRAINT certifications_pkey PRIMARY KEY (id);


--
-- Name: collect_pay_links collect_pay_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collect_pay_links
    ADD CONSTRAINT collect_pay_links_pkey PRIMARY KEY (token);


--
-- Name: compensation_plans compensation_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compensation_plans
    ADD CONSTRAINT compensation_plans_pkey PRIMARY KEY (id);


--
-- Name: customer_equipment customer_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_equipment
    ADD CONSTRAINT customer_equipment_pkey PRIMARY KEY (id);


--
-- Name: customer_vehicles customer_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_vehicles
    ADD CONSTRAINT customer_vehicles_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_user_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_user_phone_unique UNIQUE (user_id, phone_e164);


--
-- Name: earnings_ledger earnings_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_pkey PRIMARY KEY (id);


--
-- Name: feedback_submissions feedback_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_submissions
    ADD CONSTRAINT feedback_submissions_pkey PRIMARY KEY (id);


--
-- Name: field_technicians field_technicians_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_technicians
    ADD CONSTRAINT field_technicians_pkey PRIMARY KEY (id);


--
-- Name: field_technicians field_technicians_portal_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_technicians
    ADD CONSTRAINT field_technicians_portal_user_id_key UNIQUE (portal_user_id);


--
-- Name: intake_book_links intake_book_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intake_book_links
    ADD CONSTRAINT intake_book_links_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_key UNIQUE (token);


--
-- Name: job_invoices job_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoices
    ADD CONSTRAINT job_invoices_pkey PRIMARY KEY (id);


--
-- Name: job_photo_tokens job_photo_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_photo_tokens
    ADD CONSTRAINT job_photo_tokens_pkey PRIMARY KEY (id);


--
-- Name: job_photos job_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_photos
    ADD CONSTRAINT job_photos_pkey PRIMARY KEY (id);


--
-- Name: job_record_invoices job_record_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_record_invoices
    ADD CONSTRAINT job_record_invoices_pkey PRIMARY KEY (id);


--
-- Name: key_inventory_ledger key_inventory_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory_ledger
    ADD CONSTRAINT key_inventory_ledger_pkey PRIMARY KEY (id);


--
-- Name: key_inventory key_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory
    ADD CONSTRAINT key_inventory_pkey PRIMARY KEY (id);


--
-- Name: key_reorder_requests key_reorder_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_reorder_requests
    ADD CONSTRAINT key_reorder_requests_pkey PRIMARY KEY (id);


--
-- Name: latest_attention_sms_sent latest_attention_sms_sent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.latest_attention_sms_sent
    ADD CONSTRAINT latest_attention_sms_sent_pkey PRIMARY KEY (id);


--
-- Name: live_gps_locate_tokens live_gps_locate_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_gps_locate_tokens
    ADD CONSTRAINT live_gps_locate_tokens_pkey PRIMARY KEY (id);


--
-- Name: lost_leads lost_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lost_leads
    ADD CONSTRAINT lost_leads_pkey PRIMARY KEY (id);


--
-- Name: messaging_10dlc_registrations messaging_10dlc_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messaging_10dlc_registrations
    ADD CONSTRAINT messaging_10dlc_registrations_pkey PRIMARY KEY (user_id);


--
-- Name: onboarding_profiles onboarding_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_profiles
    ADD CONSTRAINT onboarding_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: operator_dashboard_heartbeats operator_dashboard_heartbeats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_dashboard_heartbeats
    ADD CONSTRAINT operator_dashboard_heartbeats_pkey PRIMARY KEY (user_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: payment_receipt_tokens payment_receipt_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_tokens
    ADD CONSTRAINT payment_receipt_tokens_pkey PRIMARY KEY (token);


--
-- Name: payment_slips payment_slips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_slips
    ADD CONSTRAINT payment_slips_pkey PRIMARY KEY (id);


--
-- Name: payout_ledger payout_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_ledger
    ADD CONSTRAINT payout_ledger_pkey PRIMARY KEY (id);


--
-- Name: pending_call_review_sms pending_call_review_sms_call_sid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_call_review_sms
    ADD CONSTRAINT pending_call_review_sms_call_sid_key UNIQUE (call_sid);


--
-- Name: pending_call_review_sms pending_call_review_sms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_call_review_sms
    ADD CONSTRAINT pending_call_review_sms_pkey PRIMARY KEY (id);


--
-- Name: pending_sms_dispositions pending_sms_dispositions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_sms_dispositions
    ADD CONSTRAINT pending_sms_dispositions_pkey PRIMARY KEY (id);


--
-- Name: pending_sms_dispositions pending_sms_dispositions_provider_call_sid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_sms_dispositions
    ADD CONSTRAINT pending_sms_dispositions_provider_call_sid_key UNIQUE (provider_call_sid);


--
-- Name: phone_numbers phone_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_numbers
    ADD CONSTRAINT phone_numbers_pkey PRIMARY KEY (id);


--
-- Name: platform_health_snapshots platform_health_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_health_snapshots
    ADD CONSTRAINT platform_health_snapshots_pkey PRIMARY KEY (check_name);


--
-- Name: playing_with_neon playing_with_neon_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playing_with_neon
    ADD CONSTRAINT playing_with_neon_pkey PRIMARY KEY (id);


--
-- Name: porting_notifications porting_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porting_notifications
    ADD CONSTRAINT porting_notifications_pkey PRIMARY KEY (id);


--
-- Name: porting_orders porting_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porting_orders
    ADD CONSTRAINT porting_orders_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: receptionist_badges receptionist_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptionist_badges
    ADD CONSTRAINT receptionist_badges_pkey PRIMARY KEY (id);


--
-- Name: receptionist_badges receptionist_badges_user_id_certification_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptionist_badges
    ADD CONSTRAINT receptionist_badges_user_id_certification_id_key UNIQUE (user_id, certification_id);


--
-- Name: receptionists receptionists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptionists
    ADD CONSTRAINT receptionists_pkey PRIMARY KEY (id);


--
-- Name: review_link_tokens review_link_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_link_tokens
    ADD CONSTRAINT review_link_tokens_pkey PRIMARY KEY (token);


--
-- Name: routing_config routing_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_config
    ADD CONSTRAINT routing_config_pkey PRIMARY KEY (id);


--
-- Name: schedule_blockouts schedule_blockouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_blockouts
    ADD CONSTRAINT schedule_blockouts_pkey PRIMARY KEY (id);


--
-- Name: scheduled_sms scheduled_sms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_sms
    ADD CONSTRAINT scheduled_sms_pkey PRIMARY KEY (id);


--
-- Name: sms_messages sms_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_pkey PRIMARY KEY (id);


--
-- Name: sms_registrations sms_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_registrations
    ADD CONSTRAINT sms_registrations_pkey PRIMARY KEY (id);


--
-- Name: support_chat_attachments support_chat_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_chat_attachments
    ADD CONSTRAINT support_chat_attachments_pkey PRIMARY KEY (id);


--
-- Name: support_chat_messages support_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_chat_messages
    ADD CONSTRAINT support_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: support_chat_threads support_chat_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_chat_threads
    ADD CONSTRAINT support_chat_threads_pkey PRIMARY KEY (id);


--
-- Name: team_invites team_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_pkey PRIMARY KEY (id);


--
-- Name: team_invites team_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_token_key UNIQUE (token);


--
-- Name: telnyx_ai_incoming_handoff telnyx_ai_incoming_handoff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telnyx_ai_incoming_handoff
    ADD CONSTRAINT telnyx_ai_incoming_handoff_pkey PRIMARY KEY (call_sid);


--
-- Name: telnyx_call_leg_links telnyx_call_leg_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telnyx_call_leg_links
    ADD CONSTRAINT telnyx_call_leg_links_pkey PRIMARY KEY (inbound_call_control_id);


--
-- Name: telnyx_inbound_dial_caller_done telnyx_inbound_dial_caller_done_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telnyx_inbound_dial_caller_done
    ADD CONSTRAINT telnyx_inbound_dial_caller_done_pkey PRIMARY KEY (call_sid);


--
-- Name: ti_supplier_catalog ti_supplier_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ti_supplier_catalog
    ADD CONSTRAINT ti_supplier_catalog_pkey PRIMARY KEY (id);


--
-- Name: ti_supplier_catalog ti_supplier_catalog_product_url_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ti_supplier_catalog
    ADD CONSTRAINT ti_supplier_catalog_product_url_uniq UNIQUE (product_url);


--
-- Name: user_ai_intake user_ai_intake_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ai_intake
    ADD CONSTRAINT user_ai_intake_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: work_shifts work_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_shifts
    ADD CONSTRAINT work_shifts_pkey PRIMARY KEY (id);


--
-- Name: worker_agreements worker_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_agreements
    ADD CONSTRAINT worker_agreements_pkey PRIMARY KEY (id);


--
-- Name: admin_support_emails_read_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_support_emails_read_at_idx ON public.admin_support_emails USING btree (read_at NULLS FIRST, received_at DESC);


--
-- Name: admin_support_emails_received_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_support_emails_received_at_idx ON public.admin_support_emails USING btree (received_at DESC);


--
-- Name: affiliate_locksmiths_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX affiliate_locksmiths_active_idx ON public.affiliate_locksmiths USING btree (user_id, active, sort_order);


--
-- Name: affiliate_locksmiths_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX affiliate_locksmiths_org_id_idx ON public.affiliate_locksmiths USING btree (organization_id);


--
-- Name: affiliate_locksmiths_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX affiliate_locksmiths_user_id_idx ON public.affiliate_locksmiths USING btree (user_id);


--
-- Name: agreement_templates_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agreement_templates_active_uidx ON public.agreement_templates USING btree (COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), kind) WHERE (is_active = true);


--
-- Name: ai_leads_assigned_tech_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_leads_assigned_tech_idx ON public.ai_leads USING btree (assigned_tech_id, created_at DESC);


--
-- Name: ai_leads_booked_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_leads_booked_by_idx ON public.ai_leads USING btree (booked_by_receptionist_id, created_at DESC) WHERE (booked_by_receptionist_id IS NOT NULL);


--
-- Name: ai_leads_disposition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_leads_disposition_idx ON public.ai_leads USING btree (user_id, disposition, created_at DESC);


--
-- Name: ai_leads_job_address_postal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_leads_job_address_postal_idx ON public.ai_leads USING btree (job_address_postal_code) WHERE (job_address_postal_code IS NOT NULL);


--
-- Name: ai_leads_org_scheduled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_leads_org_scheduled_idx ON public.ai_leads USING btree (organization_id, scheduled_at DESC NULLS LAST) WHERE (organization_id IS NOT NULL);


--
-- Name: ai_leads_scheduled_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_leads_scheduled_at_idx ON public.ai_leads USING btree (user_id, scheduled_at DESC NULLS LAST) WHERE (scheduled_at IS NOT NULL);


--
-- Name: ai_leads_source_call_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_leads_source_call_idx ON public.ai_leads USING btree (source_call_log_id) WHERE (source_call_log_id IS NOT NULL);


--
-- Name: ai_leads_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_leads_user_created_idx ON public.ai_leads USING btree (user_id, created_at DESC);


--
-- Name: amber_audit_events_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amber_audit_events_user_created_idx ON public.amber_audit_events USING btree (user_id, created_at DESC);


--
-- Name: amber_inbound_seen_seen_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amber_inbound_seen_seen_at_idx ON public.amber_inbound_seen USING btree (seen_at);


--
-- Name: amber_job_threads_one_open_per_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX amber_job_threads_one_open_per_workspace ON public.amber_job_threads USING btree (amber_workspace_id) WHERE (state = ANY (ARRAY['awaiting_instruction'::text, 'awaiting_send'::text]));


--
-- Name: amber_job_threads_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amber_job_threads_open_idx ON public.amber_job_threads USING btree (amber_workspace_id, state) WHERE (state = ANY (ARRAY['awaiting_instruction'::text, 'awaiting_send'::text]));


--
-- Name: amber_job_threads_user_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amber_job_threads_user_state_idx ON public.amber_job_threads USING btree (user_id, state, created_at DESC);


--
-- Name: amber_mobile_verifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amber_mobile_verifications_user_idx ON public.amber_mobile_verifications USING btree (user_id, created_at DESC);


--
-- Name: amber_workspaces_available_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amber_workspaces_available_at_idx ON public.amber_workspaces USING btree (presence_available_at) WHERE ((presence_available_at IS NOT NULL) AND (enabled = true));


--
-- Name: amber_workspaces_org_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX amber_workspaces_org_unique ON public.amber_workspaces USING btree (organization_id) WHERE (organization_id IS NOT NULL);


--
-- Name: amber_workspaces_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amber_workspaces_user_idx ON public.amber_workspaces USING btree (user_id);


--
-- Name: app_improvements_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_improvements_status_idx ON public.app_improvements USING btree (status, priority DESC, created_at DESC);


--
-- Name: booking_invites_owner_caller_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_invites_owner_caller_created_idx ON public.booking_invites USING btree (owner_user_id, caller_phone, created_at DESC);


--
-- Name: booking_invites_owner_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_invites_owner_created_idx ON public.booking_invites USING btree (owner_user_id, created_at DESC);


--
-- Name: booking_invites_short_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX booking_invites_short_code_uidx ON public.booking_invites USING btree (short_code) WHERE (short_code IS NOT NULL);


--
-- Name: call_queue_user_enqueued; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_queue_user_enqueued ON public.call_queue USING btree (user_id, enqueued_at DESC);


--
-- Name: call_queue_user_waiting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_queue_user_waiting ON public.call_queue USING btree (user_id, enqueued_at) WHERE (status = ANY (ARRAY['waiting'::text, 'holding'::text, 'bridging'::text]));


--
-- Name: collect_pay_links_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX collect_pay_links_owner_idx ON public.collect_pay_links USING btree (owner_user_id, created_at DESC);


--
-- Name: collect_pay_links_session_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX collect_pay_links_session_uidx ON public.collect_pay_links USING btree (stripe_session_id) WHERE ((stripe_session_id IS NOT NULL) AND (stripe_session_id <> ''::text));


--
-- Name: compensation_plans_live_receptionist_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX compensation_plans_live_receptionist_uidx ON public.compensation_plans USING btree (receptionist_id) WHERE ((effective_to IS NULL) AND (receptionist_id IS NOT NULL));


--
-- Name: compensation_plans_live_tech_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX compensation_plans_live_tech_uidx ON public.compensation_plans USING btree (field_technician_id) WHERE ((effective_to IS NULL) AND (field_technician_id IS NOT NULL));


--
-- Name: compensation_plans_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compensation_plans_owner_idx ON public.compensation_plans USING btree (owner_user_id, worker_role, effective_from DESC);


--
-- Name: compensation_plans_receptionist_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compensation_plans_receptionist_window_idx ON public.compensation_plans USING btree (receptionist_id, effective_from DESC) WHERE (receptionist_id IS NOT NULL);


--
-- Name: compensation_plans_tech_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX compensation_plans_tech_window_idx ON public.compensation_plans USING btree (field_technician_id, effective_from DESC) WHERE (field_technician_id IS NOT NULL);


--
-- Name: earnings_ledger_dedupe_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX earnings_ledger_dedupe_uidx ON public.earnings_ledger USING btree (COALESCE(receptionist_id, field_technician_id), source_kind, source_id, component_kind) WHERE ((reversed_by IS NULL) AND (reversal_of IS NULL) AND (source_id IS NOT NULL));


--
-- Name: earnings_ledger_owner_earned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX earnings_ledger_owner_earned_idx ON public.earnings_ledger USING btree (owner_user_id, earned_at DESC);


--
-- Name: earnings_ledger_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX earnings_ledger_period_idx ON public.earnings_ledger USING btree (pay_period_id) WHERE (pay_period_id IS NOT NULL);


--
-- Name: earnings_ledger_receptionist_earned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX earnings_ledger_receptionist_earned_idx ON public.earnings_ledger USING btree (receptionist_id, earned_at DESC) WHERE (receptionist_id IS NOT NULL);


--
-- Name: earnings_ledger_tech_earned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX earnings_ledger_tech_earned_idx ON public.earnings_ledger USING btree (field_technician_id, earned_at DESC) WHERE (field_technician_id IS NOT NULL);


--
-- Name: field_technicians_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_technicians_org_idx ON public.field_technicians USING btree (user_id, organization_id, is_active);


--
-- Name: field_technicians_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_technicians_owner_idx ON public.field_technicians USING btree (user_id, is_active);


--
-- Name: idx_10dlc_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_10dlc_campaign ON public.messaging_10dlc_registrations USING btree (campaign_id);


--
-- Name: idx_10dlc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_10dlc_status ON public.messaging_10dlc_registrations USING btree (status);


--
-- Name: idx_ai_assistant_presets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_assistant_presets_user ON public.ai_assistant_presets USING btree (user_id, created_at DESC);


--
-- Name: idx_ai_conversation_state_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_conversation_state_user ON public.ai_conversation_state USING btree (user_id);


--
-- Name: idx_ai_leads_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_leads_customer_id ON public.ai_leads USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_ai_leads_unassigned_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_leads_unassigned_pool ON public.ai_leads USING btree (user_id, dispatch_status, created_at DESC) WHERE ((assigned_tech_id IS NULL) AND ((job_status IS NULL) OR (job_status <> 'completed'::text)));


--
-- Name: idx_audit_events_owner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_owner_created ON public.audit_events USING btree (owner_user_id, created_at DESC);


--
-- Name: idx_audit_events_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_type_created ON public.audit_events USING btree (event_type, created_at DESC);


--
-- Name: idx_billing_ledger_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_ledger_user_created ON public.billing_ledger USING btree (user_id, created_at DESC);


--
-- Name: idx_booking_holds_owner_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_holds_owner_status ON public.booking_holds USING btree (owner_user_id, status);


--
-- Name: idx_call_logs_answered_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_answered_at ON public.call_logs USING btree (user_id, answered_at DESC);


--
-- Name: idx_call_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_created ON public.call_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_call_logs_first_ring_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_first_ring_at ON public.call_logs USING btree (user_id, first_ring_at DESC);


--
-- Name: idx_call_logs_owner_intake_dismissed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_owner_intake_dismissed ON public.call_logs USING btree (user_id, owner_intake_dismissed_at DESC) WHERE (owner_intake_dismissed_at IS NOT NULL);


--
-- Name: idx_call_logs_provider_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_provider_sid ON public.call_logs USING btree (provider_call_sid);


--
-- Name: idx_call_logs_receptionist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_receptionist ON public.call_logs USING btree (routed_to_receptionist_id);


--
-- Name: idx_call_logs_sms_follow_up_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_sms_follow_up_open ON public.call_logs USING btree (user_id, sms_follow_up_status, sms_follow_up_last_at DESC) WHERE (sms_follow_up_status = ANY (ARRAY['awaiting_reply'::text, 'replied'::text]));


--
-- Name: idx_call_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_user ON public.call_logs USING btree (user_id);


--
-- Name: idx_certifications_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_certifications_code ON public.certifications USING btree (code_identifier);


--
-- Name: idx_customer_equipment_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_equipment_customer ON public.customer_equipment USING btree (customer_id, updated_at DESC);


--
-- Name: idx_customer_equipment_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_equipment_user ON public.customer_equipment USING btree (user_id, updated_at DESC);


--
-- Name: idx_customer_vehicles_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_vehicles_customer ON public.customer_vehicles USING btree (customer_id, updated_at DESC);


--
-- Name: idx_customer_vehicles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_vehicles_user ON public.customer_vehicles USING btree (user_id, updated_at DESC);


--
-- Name: idx_customers_user_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_user_phone ON public.customers USING btree (user_id, phone_e164);


--
-- Name: idx_customers_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_user_updated ON public.customers USING btree (user_id, updated_at DESC);


--
-- Name: idx_feedback_submissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_submissions_status ON public.feedback_submissions USING btree (status, created_at DESC);


--
-- Name: idx_feedback_submissions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_submissions_user ON public.feedback_submissions USING btree (user_id, created_at DESC);


--
-- Name: idx_invitations_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_token ON public.invitations USING btree (token);


--
-- Name: idx_latest_attention_sms_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_latest_attention_sms_dedupe ON public.latest_attention_sms_sent USING btree (user_id, event_type, dedupe_key);


--
-- Name: idx_latest_attention_sms_user_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_latest_attention_sms_user_sent ON public.latest_attention_sms_sent USING btree (user_id, sent_at DESC);


--
-- Name: idx_onboarding_profiles_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_profiles_subscription ON public.onboarding_profiles USING btree (has_active_subscription);


--
-- Name: idx_phone_numbers_active_digits; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_numbers_active_digits ON public.phone_numbers USING btree (number_digits) WHERE (status = 'active'::text);


--
-- Name: idx_phone_numbers_active_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_numbers_active_number ON public.phone_numbers USING btree (number) WHERE (status = 'active'::text);


--
-- Name: idx_phone_numbers_provider_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_numbers_provider_sid ON public.phone_numbers USING btree (provider_number_sid);


--
-- Name: idx_phone_numbers_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_numbers_user ON public.phone_numbers USING btree (user_id);


--
-- Name: idx_porting_notifications_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_porting_notifications_event_id ON public.porting_notifications USING btree (telnyx_event_id);


--
-- Name: idx_porting_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_porting_notifications_user_created ON public.porting_notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_porting_notifications_user_org_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_porting_notifications_user_org_created ON public.porting_notifications USING btree (user_id, organization_id, created_at DESC);


--
-- Name: idx_porting_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_porting_notifications_user_unread ON public.porting_notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: idx_receptionist_badges_active_certified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receptionist_badges_active_certified ON public.receptionist_badges USING btree (user_id, certification_id) WHERE ((status = 'certified'::text) AND (active_toggle = true));


--
-- Name: idx_receptionist_badges_cert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receptionist_badges_cert ON public.receptionist_badges USING btree (certification_id);


--
-- Name: idx_receptionist_badges_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receptionist_badges_user ON public.receptionist_badges USING btree (user_id);


--
-- Name: idx_receptionists_network_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receptionists_network_pool ON public.receptionists USING btree (is_active) WHERE (user_id IS NULL);


--
-- Name: idx_receptionists_portal_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_receptionists_portal_user ON public.receptionists USING btree (portal_user_id) WHERE (portal_user_id IS NOT NULL);


--
-- Name: idx_receptionists_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receptionists_user ON public.receptionists USING btree (user_id);


--
-- Name: idx_routing_config_user_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_routing_config_user_number ON public.routing_config USING btree (user_id, COALESCE(business_number, '__default__'::text));


--
-- Name: idx_schedule_blockouts_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedule_blockouts_user_date ON public.schedule_blockouts USING btree (user_id, date);


--
-- Name: idx_sms_messages_call_log; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_messages_call_log ON public.sms_messages USING btree (call_log_id) WHERE (call_log_id IS NOT NULL);


--
-- Name: idx_team_invites_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invites_email ON public.team_invites USING btree (lower(email));


--
-- Name: idx_team_invites_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invites_pending ON public.team_invites USING btree (expires_at) WHERE (accepted_at IS NULL);


--
-- Name: idx_team_invites_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_invites_token ON public.team_invites USING btree (token);


--
-- Name: idx_telnyx_inbound_dial_caller_done_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telnyx_inbound_dial_caller_done_created_at ON public.telnyx_inbound_dial_caller_done USING btree (created_at DESC);


--
-- Name: idx_users_invitation_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_invitation_token ON public.users USING btree (invitation_token) WHERE (invitation_token IS NOT NULL);


--
-- Name: idx_users_invite_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_invite_token ON public.users USING btree (invite_token) WHERE (invite_token IS NOT NULL);


--
-- Name: intake_book_links_owner_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intake_book_links_owner_created_idx ON public.intake_book_links USING btree (owner_user_id, created_at DESC);


--
-- Name: intake_book_links_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intake_book_links_phone_idx ON public.intake_book_links USING btree (owner_user_id, caller_phone);


--
-- Name: job_invoices_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_invoices_owner_idx ON public.job_invoices USING btree (owner_user_id, created_at DESC);


--
-- Name: job_photo_tokens_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_photo_tokens_owner_idx ON public.job_photo_tokens USING btree (owner_user_id, created_at DESC);


--
-- Name: job_photos_call_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_photos_call_idx ON public.job_photos USING btree (owner_user_id, call_log_id, created_at DESC);


--
-- Name: job_photos_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_photos_token_idx ON public.job_photos USING btree (token_id, created_at);


--
-- Name: job_record_invoices_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_record_invoices_customer_idx ON public.job_record_invoices USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: job_record_invoices_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_record_invoices_job_idx ON public.job_record_invoices USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: job_record_invoices_owner_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_record_invoices_owner_created_idx ON public.job_record_invoices USING btree (owner_user_id, created_at DESC);


--
-- Name: job_record_invoices_owner_invoice_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_record_invoices_owner_invoice_number_idx ON public.job_record_invoices USING btree (owner_user_id, invoice_number);


--
-- Name: job_record_invoices_owner_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_record_invoices_owner_status_idx ON public.job_record_invoices USING btree (owner_user_id, delivery_status, created_at DESC);


--
-- Name: job_record_invoices_receipt_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX job_record_invoices_receipt_token_uidx ON public.job_record_invoices USING btree (receipt_token);


--
-- Name: key_inventory_alt_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_alt_sku_idx ON public.key_inventory USING btree (alt_sku);


--
-- Name: key_inventory_compatible_vehicles_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_compatible_vehicles_gin_idx ON public.key_inventory USING gin (compatible_vehicles jsonb_path_ops);


--
-- Name: key_inventory_cross_ref_ti_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_cross_ref_ti_sku_idx ON public.key_inventory USING btree (cross_ref_ti_sku);


--
-- Name: key_inventory_fcc_id_upper_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_fcc_id_upper_idx ON public.key_inventory USING btree (upper(regexp_replace(fcc_id, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)));


--
-- Name: key_inventory_ledger_item_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_ledger_item_created_idx ON public.key_inventory_ledger USING btree (key_inventory_id, created_at DESC);


--
-- Name: key_inventory_ledger_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_ledger_job_idx ON public.key_inventory_ledger USING btree (job_id) WHERE (job_id IS NOT NULL);


--
-- Name: key_inventory_ledger_owner_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_ledger_owner_created_idx ON public.key_inventory_ledger USING btree (owner_user_id, created_at DESC);


--
-- Name: key_inventory_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_organization_id_idx ON public.key_inventory USING btree (organization_id);


--
-- Name: key_inventory_product_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_product_url_idx ON public.key_inventory USING btree (product_url);


--
-- Name: key_inventory_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_sku_idx ON public.key_inventory USING btree (sku);


--
-- Name: key_inventory_supplier_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_supplier_name_idx ON public.key_inventory USING btree (supplier_name);


--
-- Name: key_inventory_ti_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_ti_sku_idx ON public.key_inventory USING btree (ti_sku);


--
-- Name: key_inventory_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_inventory_user_id_idx ON public.key_inventory USING btree (user_id);


--
-- Name: key_reorder_requests_inventory_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_reorder_requests_inventory_idx ON public.key_reorder_requests USING btree (key_inventory_id) WHERE (key_inventory_id IS NOT NULL);


--
-- Name: key_reorder_requests_owner_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_reorder_requests_owner_status_idx ON public.key_reorder_requests USING btree (owner_user_id, status, created_at DESC);


--
-- Name: live_gps_locate_tokens_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX live_gps_locate_tokens_owner_idx ON public.live_gps_locate_tokens USING btree (owner_user_id, created_at DESC);


--
-- Name: lost_leads_pending_recovery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lost_leads_pending_recovery_idx ON public.lost_leads USING btree (status, created_at) WHERE (recovery_sms_sent_at IS NULL);


--
-- Name: lost_leads_recovery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lost_leads_recovery_idx ON public.lost_leads USING btree (user_id, status, created_at DESC);


--
-- Name: organizations_owner_default_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organizations_owner_default_uidx ON public.organizations USING btree (owner_user_id) WHERE (is_default = true);


--
-- Name: organizations_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_owner_idx ON public.organizations USING btree (owner_user_id, created_at);


--
-- Name: payment_receipt_tokens_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_receipt_tokens_owner_idx ON public.payment_receipt_tokens USING btree (owner_user_id, created_at DESC);


--
-- Name: payment_receipt_tokens_pi_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_receipt_tokens_pi_uidx ON public.payment_receipt_tokens USING btree (stripe_payment_intent_id);


--
-- Name: payment_slips_pi_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_slips_pi_uidx ON public.payment_slips USING btree (stripe_payment_intent_id);


--
-- Name: payment_slips_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_slips_user_created_idx ON public.payment_slips USING btree (user_id, created_at DESC);


--
-- Name: payout_ledger_rec_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payout_ledger_rec_idx ON public.payout_ledger USING btree (receptionist_id, created_at DESC);


--
-- Name: pending_call_review_sms_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_call_review_sms_due_idx ON public.pending_call_review_sms USING btree (status, check_after);


--
-- Name: pending_sms_dispositions_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_sms_dispositions_phone_idx ON public.pending_sms_dispositions USING btree (receptionist_phone_e164, responded_at, created_at DESC);


--
-- Name: phone_numbers_organization_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_numbers_organization_idx ON public.phone_numbers USING btree (organization_id, status);


--
-- Name: porting_orders_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX porting_orders_org_idx ON public.porting_orders USING btree (organization_id, created_at DESC);


--
-- Name: porting_orders_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX porting_orders_owner_idx ON public.porting_orders USING btree (owner_user_id, created_at DESC);


--
-- Name: porting_orders_telnyx_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX porting_orders_telnyx_idx ON public.porting_orders USING btree (telnyx_order_id) WHERE (telnyx_order_id IS NOT NULL);


--
-- Name: review_link_tokens_lead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_link_tokens_lead_idx ON public.review_link_tokens USING btree (lead_id) WHERE (lead_id IS NOT NULL);


--
-- Name: review_link_tokens_owner_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_link_tokens_owner_created_idx ON public.review_link_tokens USING btree (owner_user_id, created_at DESC);


--
-- Name: routing_config_oncall_tech_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routing_config_oncall_tech_idx ON public.routing_config USING btree (oncall_technician_id);


--
-- Name: scheduled_sms_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scheduled_sms_due_idx ON public.scheduled_sms USING btree (status, send_after);


--
-- Name: sms_messages_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_messages_org_created_idx ON public.sms_messages USING btree (organization_id, created_at DESC);


--
-- Name: sms_messages_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_messages_owner_idx ON public.sms_messages USING btree (owner_user_id, created_at DESC);


--
-- Name: sms_messages_telnyx_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_messages_telnyx_id_idx ON public.sms_messages USING btree (telnyx_message_id) WHERE (telnyx_message_id IS NOT NULL);


--
-- Name: sms_messages_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_messages_thread_idx ON public.sms_messages USING btree (organization_id, customer_phone, created_at DESC);


--
-- Name: sms_registrations_org_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sms_registrations_org_uidx ON public.sms_registrations USING btree (organization_id) WHERE (organization_id IS NOT NULL);


--
-- Name: sms_registrations_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sms_registrations_owner_idx ON public.sms_registrations USING btree (owner_user_id, updated_at DESC);


--
-- Name: sms_registrations_owner_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sms_registrations_owner_uidx ON public.sms_registrations USING btree (owner_user_id) WHERE (organization_id IS NULL);


--
-- Name: support_chat_attachments_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_chat_attachments_message_idx ON public.support_chat_attachments USING btree (message_id);


--
-- Name: support_chat_messages_thread_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_chat_messages_thread_created_idx ON public.support_chat_messages USING btree (thread_id, created_at);


--
-- Name: support_chat_threads_admin_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_chat_threads_admin_unread_idx ON public.support_chat_threads USING btree (admin_unread_count DESC, last_message_at DESC NULLS LAST) WHERE (admin_unread_count > 0);


--
-- Name: support_chat_threads_last_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_chat_threads_last_message_idx ON public.support_chat_threads USING btree (last_message_at DESC NULLS LAST);


--
-- Name: support_chat_threads_one_active_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX support_chat_threads_one_active_per_user ON public.support_chat_threads USING btree (user_id) WHERE (status = ANY (ARRAY['open'::text, 'waiting'::text]));


--
-- Name: telnyx_ai_incoming_handoff_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telnyx_ai_incoming_handoff_created_at_idx ON public.telnyx_ai_incoming_handoff USING btree (created_at);


--
-- Name: telnyx_call_leg_links_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telnyx_call_leg_links_created_at_idx ON public.telnyx_call_leg_links USING btree (created_at);


--
-- Name: ti_supplier_catalog_cross_ref_ti_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ti_supplier_catalog_cross_ref_ti_sku_idx ON public.ti_supplier_catalog USING btree (cross_ref_ti_sku);


--
-- Name: ti_supplier_catalog_fcc_id_upper_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ti_supplier_catalog_fcc_id_upper_idx ON public.ti_supplier_catalog USING btree (upper(regexp_replace(fcc_id, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)));


--
-- Name: ti_supplier_catalog_ti_sku_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ti_supplier_catalog_ti_sku_idx ON public.ti_supplier_catalog USING btree (ti_sku);


--
-- Name: users_stripe_connect_account_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_stripe_connect_account_uidx ON public.users USING btree (stripe_connect_account_id) WHERE (stripe_connect_account_id IS NOT NULL);


--
-- Name: wallet_transactions_customer_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_transactions_customer_phone_idx ON public.wallet_transactions USING btree (customer_phone) WHERE ((customer_phone IS NOT NULL) AND (customer_phone <> ''::text));


--
-- Name: wallet_transactions_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_transactions_job_idx ON public.wallet_transactions USING btree (job_id);


--
-- Name: wallet_transactions_owner_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_transactions_owner_status_idx ON public.wallet_transactions USING btree (owner_user_id, status) WHERE (owner_user_id IS NOT NULL);


--
-- Name: wallet_transactions_reverses_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_transactions_reverses_idx ON public.wallet_transactions USING btree (reverses_transaction_id) WHERE (reverses_transaction_id IS NOT NULL);


--
-- Name: wallet_transactions_stripe_pi_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wallet_transactions_stripe_pi_uidx ON public.wallet_transactions USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);


--
-- Name: wallet_transactions_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_transactions_user_created_idx ON public.wallet_transactions USING btree (user_id, created_at DESC);


--
-- Name: wallet_transactions_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wallet_transactions_user_status_idx ON public.wallet_transactions USING btree (user_id, status);


--
-- Name: work_shifts_open_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_shifts_open_scan_idx ON public.work_shifts USING btree (started_at) WHERE (ended_at IS NULL);


--
-- Name: work_shifts_open_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX work_shifts_open_uidx ON public.work_shifts USING btree (COALESCE(receptionist_id, field_technician_id)) WHERE (ended_at IS NULL);


--
-- Name: work_shifts_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_shifts_owner_idx ON public.work_shifts USING btree (owner_user_id, started_at DESC);


--
-- Name: work_shifts_receptionist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_shifts_receptionist_idx ON public.work_shifts USING btree (receptionist_id, started_at DESC) WHERE (receptionist_id IS NOT NULL);


--
-- Name: work_shifts_tech_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_shifts_tech_idx ON public.work_shifts USING btree (field_technician_id, started_at DESC) WHERE (field_technician_id IS NOT NULL);


--
-- Name: worker_agreements_invite_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_agreements_invite_idx ON public.worker_agreements USING btree (invite_id) WHERE (invite_id IS NOT NULL);


--
-- Name: worker_agreements_invite_pending_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX worker_agreements_invite_pending_uidx ON public.worker_agreements USING btree (invite_id) WHERE ((invite_id IS NOT NULL) AND (status = 'PENDING'::text));


--
-- Name: worker_agreements_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_agreements_owner_idx ON public.worker_agreements USING btree (owner_user_id, created_at DESC);


--
-- Name: worker_agreements_worker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_agreements_worker_idx ON public.worker_agreements USING btree (worker_user_id, created_at DESC) WHERE (worker_user_id IS NOT NULL);


--
-- Name: account_settings account_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_settings
    ADD CONSTRAINT account_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: account_weekly_hours account_weekly_hours_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_weekly_hours
    ADD CONSTRAINT account_weekly_hours_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: affiliate_locksmiths affiliate_locksmiths_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_locksmiths
    ADD CONSTRAINT affiliate_locksmiths_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: affiliate_locksmiths affiliate_locksmiths_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.affiliate_locksmiths
    ADD CONSTRAINT affiliate_locksmiths_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: agreement_templates agreement_templates_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agreement_templates
    ADD CONSTRAINT agreement_templates_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_assistant_presets ai_assistant_presets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_assistant_presets
    ADD CONSTRAINT ai_assistant_presets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_conversation_state ai_conversation_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversation_state
    ADD CONSTRAINT ai_conversation_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_leads ai_leads_assigned_tech_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_leads
    ADD CONSTRAINT ai_leads_assigned_tech_id_fkey FOREIGN KEY (assigned_tech_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_leads ai_leads_booked_by_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_leads
    ADD CONSTRAINT ai_leads_booked_by_receptionist_id_fkey FOREIGN KEY (booked_by_receptionist_id) REFERENCES public.receptionists(id) ON DELETE SET NULL;


--
-- Name: ai_leads ai_leads_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_leads
    ADD CONSTRAINT ai_leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: ai_leads ai_leads_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_leads
    ADD CONSTRAINT ai_leads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: ai_leads ai_leads_source_call_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_leads
    ADD CONSTRAINT ai_leads_source_call_log_id_fkey FOREIGN KEY (source_call_log_id) REFERENCES public.call_logs(id) ON DELETE SET NULL;


--
-- Name: ai_leads ai_leads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_leads
    ADD CONSTRAINT ai_leads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: amber_audit_events amber_audit_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_audit_events
    ADD CONSTRAINT amber_audit_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: amber_audit_events amber_audit_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_audit_events
    ADD CONSTRAINT amber_audit_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: amber_job_threads amber_job_threads_amber_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_job_threads
    ADD CONSTRAINT amber_job_threads_amber_workspace_id_fkey FOREIGN KEY (amber_workspace_id) REFERENCES public.amber_workspaces(id) ON DELETE CASCADE;


--
-- Name: amber_job_threads amber_job_threads_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_job_threads
    ADD CONSTRAINT amber_job_threads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: amber_job_threads amber_job_threads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_job_threads
    ADD CONSTRAINT amber_job_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: amber_mobile_verifications amber_mobile_verifications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_mobile_verifications
    ADD CONSTRAINT amber_mobile_verifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: amber_mobile_verifications amber_mobile_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_mobile_verifications
    ADD CONSTRAINT amber_mobile_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: amber_workspaces amber_workspaces_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_workspaces
    ADD CONSTRAINT amber_workspaces_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: amber_workspaces amber_workspaces_phone_number_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_workspaces
    ADD CONSTRAINT amber_workspaces_phone_number_id_fkey FOREIGN KEY (phone_number_id) REFERENCES public.phone_numbers(id) ON DELETE RESTRICT;


--
-- Name: amber_workspaces amber_workspaces_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amber_workspaces
    ADD CONSTRAINT amber_workspaces_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: app_improvements app_improvements_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_improvements
    ADD CONSTRAINT app_improvements_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: billing_ledger billing_ledger_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_ledger
    ADD CONSTRAINT billing_ledger_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: billing_ledger billing_ledger_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_ledger
    ADD CONSTRAINT billing_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: booking_holds booking_holds_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_holds
    ADD CONSTRAINT booking_holds_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: booking_invites booking_invites_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_invites
    ADD CONSTRAINT booking_invites_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: call_logs call_logs_routed_to_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_routed_to_receptionist_id_fkey FOREIGN KEY (routed_to_receptionist_id) REFERENCES public.receptionists(id) ON DELETE SET NULL;


--
-- Name: call_logs call_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: call_queue call_queue_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_queue
    ADD CONSTRAINT call_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: collect_pay_links collect_pay_links_acting_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collect_pay_links
    ADD CONSTRAINT collect_pay_links_acting_user_id_fkey FOREIGN KEY (acting_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: collect_pay_links collect_pay_links_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collect_pay_links
    ADD CONSTRAINT collect_pay_links_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: collect_pay_links collect_pay_links_tech_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collect_pay_links
    ADD CONSTRAINT collect_pay_links_tech_user_id_fkey FOREIGN KEY (tech_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compensation_plans compensation_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compensation_plans
    ADD CONSTRAINT compensation_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compensation_plans compensation_plans_field_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compensation_plans
    ADD CONSTRAINT compensation_plans_field_technician_id_fkey FOREIGN KEY (field_technician_id) REFERENCES public.field_technicians(id) ON DELETE CASCADE;


--
-- Name: compensation_plans compensation_plans_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compensation_plans
    ADD CONSTRAINT compensation_plans_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: compensation_plans compensation_plans_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compensation_plans
    ADD CONSTRAINT compensation_plans_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: compensation_plans compensation_plans_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compensation_plans
    ADD CONSTRAINT compensation_plans_receptionist_id_fkey FOREIGN KEY (receptionist_id) REFERENCES public.receptionists(id) ON DELETE CASCADE;


--
-- Name: compensation_plans compensation_plans_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compensation_plans
    ADD CONSTRAINT compensation_plans_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.compensation_plans(id) ON DELETE SET NULL;


--
-- Name: compensation_plans compensation_plans_worker_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compensation_plans
    ADD CONSTRAINT compensation_plans_worker_user_id_fkey FOREIGN KEY (worker_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customer_equipment customer_equipment_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_equipment
    ADD CONSTRAINT customer_equipment_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_equipment customer_equipment_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_equipment
    ADD CONSTRAINT customer_equipment_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: customer_vehicles customer_vehicles_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_vehicles
    ADD CONSTRAINT customer_vehicles_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_vehicles customer_vehicles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_vehicles
    ADD CONSTRAINT customer_vehicles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: customers customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: earnings_ledger earnings_ledger_field_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_field_technician_id_fkey FOREIGN KEY (field_technician_id) REFERENCES public.field_technicians(id) ON DELETE CASCADE;


--
-- Name: earnings_ledger earnings_ledger_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: earnings_ledger earnings_ledger_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: earnings_ledger earnings_ledger_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.compensation_plans(id) ON DELETE SET NULL;


--
-- Name: earnings_ledger earnings_ledger_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_receptionist_id_fkey FOREIGN KEY (receptionist_id) REFERENCES public.receptionists(id) ON DELETE CASCADE;


--
-- Name: earnings_ledger earnings_ledger_reversal_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_reversal_of_fkey FOREIGN KEY (reversal_of) REFERENCES public.earnings_ledger(id) ON DELETE SET NULL;


--
-- Name: earnings_ledger earnings_ledger_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.earnings_ledger(id) ON DELETE SET NULL;


--
-- Name: earnings_ledger earnings_ledger_worker_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_ledger
    ADD CONSTRAINT earnings_ledger_worker_user_id_fkey FOREIGN KEY (worker_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: feedback_submissions feedback_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_submissions
    ADD CONSTRAINT feedback_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: field_technicians field_technicians_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_technicians
    ADD CONSTRAINT field_technicians_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: field_technicians field_technicians_portal_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_technicians
    ADD CONSTRAINT field_technicians_portal_user_id_fkey FOREIGN KEY (portal_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: field_technicians field_technicians_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_technicians
    ADD CONSTRAINT field_technicians_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: intake_book_links intake_book_links_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intake_book_links
    ADD CONSTRAINT intake_book_links_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: job_invoices job_invoices_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoices
    ADD CONSTRAINT job_invoices_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.ai_leads(id) ON DELETE SET NULL;


--
-- Name: job_invoices job_invoices_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoices
    ADD CONSTRAINT job_invoices_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: job_invoices job_invoices_tech_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_invoices
    ADD CONSTRAINT job_invoices_tech_user_id_fkey FOREIGN KEY (tech_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_photo_tokens job_photo_tokens_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_photo_tokens
    ADD CONSTRAINT job_photo_tokens_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: job_photos job_photos_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_photos
    ADD CONSTRAINT job_photos_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: job_photos job_photos_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_photos
    ADD CONSTRAINT job_photos_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.job_photo_tokens(id) ON DELETE CASCADE;


--
-- Name: job_record_invoices job_record_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_record_invoices
    ADD CONSTRAINT job_record_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: job_record_invoices job_record_invoices_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_record_invoices
    ADD CONSTRAINT job_record_invoices_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.ai_leads(id) ON DELETE SET NULL;


--
-- Name: job_record_invoices job_record_invoices_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_record_invoices
    ADD CONSTRAINT job_record_invoices_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: job_record_invoices job_record_invoices_parent_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_record_invoices
    ADD CONSTRAINT job_record_invoices_parent_invoice_id_fkey FOREIGN KEY (parent_invoice_id) REFERENCES public.job_record_invoices(id) ON DELETE SET NULL;


--
-- Name: key_inventory_ledger key_inventory_ledger_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory_ledger
    ADD CONSTRAINT key_inventory_ledger_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: key_inventory_ledger key_inventory_ledger_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory_ledger
    ADD CONSTRAINT key_inventory_ledger_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.ai_leads(id) ON DELETE SET NULL;


--
-- Name: key_inventory_ledger key_inventory_ledger_key_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory_ledger
    ADD CONSTRAINT key_inventory_ledger_key_inventory_id_fkey FOREIGN KEY (key_inventory_id) REFERENCES public.key_inventory(id) ON DELETE CASCADE;


--
-- Name: key_inventory_ledger key_inventory_ledger_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory_ledger
    ADD CONSTRAINT key_inventory_ledger_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: key_inventory_ledger key_inventory_ledger_reorder_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory_ledger
    ADD CONSTRAINT key_inventory_ledger_reorder_request_id_fkey FOREIGN KEY (reorder_request_id) REFERENCES public.key_reorder_requests(id) ON DELETE SET NULL;


--
-- Name: key_inventory key_inventory_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory
    ADD CONSTRAINT key_inventory_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: key_inventory key_inventory_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_inventory
    ADD CONSTRAINT key_inventory_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: key_reorder_requests key_reorder_requests_decided_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_reorder_requests
    ADD CONSTRAINT key_reorder_requests_decided_by_user_id_fkey FOREIGN KEY (decided_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: key_reorder_requests key_reorder_requests_key_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_reorder_requests
    ADD CONSTRAINT key_reorder_requests_key_inventory_id_fkey FOREIGN KEY (key_inventory_id) REFERENCES public.key_inventory(id) ON DELETE SET NULL;


--
-- Name: key_reorder_requests key_reorder_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_reorder_requests
    ADD CONSTRAINT key_reorder_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: key_reorder_requests key_reorder_requests_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_reorder_requests
    ADD CONSTRAINT key_reorder_requests_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: key_reorder_requests key_reorder_requests_requested_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_reorder_requests
    ADD CONSTRAINT key_reorder_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: latest_attention_sms_sent latest_attention_sms_sent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.latest_attention_sms_sent
    ADD CONSTRAINT latest_attention_sms_sent_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: live_gps_locate_tokens live_gps_locate_tokens_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_gps_locate_tokens
    ADD CONSTRAINT live_gps_locate_tokens_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: lost_leads lost_leads_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lost_leads
    ADD CONSTRAINT lost_leads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: lost_leads lost_leads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lost_leads
    ADD CONSTRAINT lost_leads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messaging_10dlc_registrations messaging_10dlc_registrations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messaging_10dlc_registrations
    ADD CONSTRAINT messaging_10dlc_registrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: onboarding_profiles onboarding_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_profiles
    ADD CONSTRAINT onboarding_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: operator_dashboard_heartbeats operator_dashboard_heartbeats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operator_dashboard_heartbeats
    ADD CONSTRAINT operator_dashboard_heartbeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organizations organizations_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payment_receipt_tokens payment_receipt_tokens_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_tokens
    ADD CONSTRAINT payment_receipt_tokens_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payment_slips payment_slips_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_slips
    ADD CONSTRAINT payment_slips_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payout_ledger payout_ledger_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_ledger
    ADD CONSTRAINT payout_ledger_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payout_ledger payout_ledger_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_ledger
    ADD CONSTRAINT payout_ledger_receptionist_id_fkey FOREIGN KEY (receptionist_id) REFERENCES public.receptionists(id) ON DELETE CASCADE;


--
-- Name: pending_call_review_sms pending_call_review_sms_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_call_review_sms
    ADD CONSTRAINT pending_call_review_sms_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pending_sms_dispositions pending_sms_dispositions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_sms_dispositions
    ADD CONSTRAINT pending_sms_dispositions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: phone_numbers phone_numbers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_numbers
    ADD CONSTRAINT phone_numbers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: phone_numbers phone_numbers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_numbers
    ADD CONSTRAINT phone_numbers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: porting_notifications porting_notifications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porting_notifications
    ADD CONSTRAINT porting_notifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: porting_notifications porting_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porting_notifications
    ADD CONSTRAINT porting_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: porting_orders porting_orders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porting_orders
    ADD CONSTRAINT porting_orders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: porting_orders porting_orders_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.porting_orders
    ADD CONSTRAINT porting_orders_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: receptionist_badges receptionist_badges_certification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptionist_badges
    ADD CONSTRAINT receptionist_badges_certification_id_fkey FOREIGN KEY (certification_id) REFERENCES public.certifications(id) ON DELETE CASCADE;


--
-- Name: receptionist_badges receptionist_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptionist_badges
    ADD CONSTRAINT receptionist_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: receptionists receptionists_portal_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptionists
    ADD CONSTRAINT receptionists_portal_user_id_fkey FOREIGN KEY (portal_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: receptionists receptionists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receptionists
    ADD CONSTRAINT receptionists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: review_link_tokens review_link_tokens_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_link_tokens
    ADD CONSTRAINT review_link_tokens_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: routing_config routing_config_oncall_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_config
    ADD CONSTRAINT routing_config_oncall_technician_id_fkey FOREIGN KEY (oncall_technician_id) REFERENCES public.field_technicians(id) ON DELETE SET NULL;


--
-- Name: routing_config routing_config_selected_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_config
    ADD CONSTRAINT routing_config_selected_receptionist_id_fkey FOREIGN KEY (selected_receptionist_id) REFERENCES public.receptionists(id) ON DELETE SET NULL;


--
-- Name: routing_config routing_config_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_config
    ADD CONSTRAINT routing_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: schedule_blockouts schedule_blockouts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_blockouts
    ADD CONSTRAINT schedule_blockouts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: schedule_blockouts schedule_blockouts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_blockouts
    ADD CONSTRAINT schedule_blockouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: scheduled_sms scheduled_sms_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_sms
    ADD CONSTRAINT scheduled_sms_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sms_messages sms_messages_call_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_call_log_id_fkey FOREIGN KEY (call_log_id) REFERENCES public.call_logs(id) ON DELETE SET NULL;


--
-- Name: sms_messages sms_messages_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: sms_messages sms_messages_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sms_messages sms_messages_phone_number_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_phone_number_id_fkey FOREIGN KEY (phone_number_id) REFERENCES public.phone_numbers(id) ON DELETE SET NULL;


--
-- Name: sms_registrations sms_registrations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_registrations
    ADD CONSTRAINT sms_registrations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: sms_registrations sms_registrations_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_registrations
    ADD CONSTRAINT sms_registrations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_chat_attachments support_chat_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_chat_attachments
    ADD CONSTRAINT support_chat_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.support_chat_messages(id) ON DELETE CASCADE;


--
-- Name: support_chat_messages support_chat_messages_sender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_chat_messages
    ADD CONSTRAINT support_chat_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_chat_messages support_chat_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_chat_messages
    ADD CONSTRAINT support_chat_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.support_chat_threads(id) ON DELETE CASCADE;


--
-- Name: support_chat_threads support_chat_threads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_chat_threads
    ADD CONSTRAINT support_chat_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: team_invites team_invites_accepted_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_accepted_user_id_fkey FOREIGN KEY (accepted_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: team_invites team_invites_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_ai_intake user_ai_intake_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_ai_intake
    ADD CONSTRAINT user_ai_intake_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wallet_transactions wallet_transactions_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.ai_leads(id) ON DELETE SET NULL;


--
-- Name: wallet_transactions wallet_transactions_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: wallet_transactions wallet_transactions_reverses_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_reverses_transaction_id_fkey FOREIGN KEY (reverses_transaction_id) REFERENCES public.wallet_transactions(id) ON DELETE SET NULL;


--
-- Name: wallet_transactions wallet_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: work_shifts work_shifts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_shifts
    ADD CONSTRAINT work_shifts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: work_shifts work_shifts_field_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_shifts
    ADD CONSTRAINT work_shifts_field_technician_id_fkey FOREIGN KEY (field_technician_id) REFERENCES public.field_technicians(id) ON DELETE CASCADE;


--
-- Name: work_shifts work_shifts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_shifts
    ADD CONSTRAINT work_shifts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: work_shifts work_shifts_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_shifts
    ADD CONSTRAINT work_shifts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: work_shifts work_shifts_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_shifts
    ADD CONSTRAINT work_shifts_receptionist_id_fkey FOREIGN KEY (receptionist_id) REFERENCES public.receptionists(id) ON DELETE CASCADE;


--
-- Name: work_shifts work_shifts_worker_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_shifts
    ADD CONSTRAINT work_shifts_worker_user_id_fkey FOREIGN KEY (worker_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: worker_agreements worker_agreements_field_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_agreements
    ADD CONSTRAINT worker_agreements_field_technician_id_fkey FOREIGN KEY (field_technician_id) REFERENCES public.field_technicians(id) ON DELETE SET NULL;


--
-- Name: worker_agreements worker_agreements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_agreements
    ADD CONSTRAINT worker_agreements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: worker_agreements worker_agreements_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_agreements
    ADD CONSTRAINT worker_agreements_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: worker_agreements worker_agreements_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_agreements
    ADD CONSTRAINT worker_agreements_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.compensation_plans(id) ON DELETE SET NULL;


--
-- Name: worker_agreements worker_agreements_receptionist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_agreements
    ADD CONSTRAINT worker_agreements_receptionist_id_fkey FOREIGN KEY (receptionist_id) REFERENCES public.receptionists(id) ON DELETE SET NULL;


--
-- Name: worker_agreements worker_agreements_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_agreements
    ADD CONSTRAINT worker_agreements_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.agreement_templates(id) ON DELETE SET NULL;


--
-- Name: worker_agreements worker_agreements_worker_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_agreements
    ADD CONSTRAINT worker_agreements_worker_user_id_fkey FOREIGN KEY (worker_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--


