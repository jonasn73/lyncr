-- 147: Worker agreements — what someone signed, and what it said when they signed it.
-- Run in Neon SQL Editor after 146-work-shifts.sql.
--
-- Nothing recorded the terms a receptionist or tech agreed to. Pay was whatever the
-- invite happened to carry, employment type was never asked, and there was no artifact
-- either side could point at later.
--
-- The design rule here is that the agreement freezes. rendered_body holds the fully
-- interpolated text as shown at signing, and body_sha256 fingerprints it, so a later
-- change to the template or the pay plan cannot rewrite what someone agreed to. That is
-- the whole point: ESIGN and UETA ask that a signature be logically associated with the
-- specific record, and that both parties can retain and reproduce it.
--
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS agreement_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = a Lyncr default available to every business. Set = this owner's own wording.
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN
                  ('W2_OFFER', 'CONTRACTOR_AGREEMENT', 'PAY_ADDENDUM')),
  version       INTEGER NOT NULL DEFAULT 1,
  -- Markdown with {{placeholders}} — see lib/agreements/render.ts for the field list.
  body_md       TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active version per kind per owner. The partial unique index allows an owner to
-- keep older versions around for agreements already signed against them.
CREATE UNIQUE INDEX IF NOT EXISTS agreement_templates_active_uidx
  ON agreement_templates (COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS worker_agreements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Set once the worker has an account. Null while the agreement is attached to an
  -- invite that has not been redeemed — someone signs before they have a login.
  worker_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  worker_role         TEXT NOT NULL CHECK (worker_role IN ('receptionist', 'field_tech')),
  receptionist_id     UUID REFERENCES receptionists(id) ON DELETE SET NULL,
  field_technician_id UUID REFERENCES field_technicians(id) ON DELETE SET NULL,

  -- team_invites.id when the agreement was created alongside an invite.
  invite_id           UUID,
  template_id         UUID REFERENCES agreement_templates(id) ON DELETE SET NULL,
  -- The plan version these terms describe.
  plan_id             UUID REFERENCES compensation_plans(id) ON DELETE SET NULL,

  employment_type     TEXT NOT NULL
                        CHECK (employment_type IN ('W2_EMPLOYEE', 'CONTRACTOR_1099')),

  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'SIGNED', 'DECLINED', 'VOID')),

  -- Frozen at send time. Never regenerated — a template edit must not change what
  -- someone already agreed to.
  rendered_body       TEXT NOT NULL,
  body_sha256         TEXT NOT NULL,
  -- One-sentence pay summary, denormalized so a signed row reads on its own.
  pay_summary         TEXT NOT NULL DEFAULT '',
  -- The PayComponent[] these terms describe, carried on the agreement because someone
  -- signs before they have a roster row to hang a compensation_plan off. On signing,
  -- this is what the plan is built from — so the plan cannot say something the signed
  -- document does not.
  plan_components     JSONB NOT NULL DEFAULT '[]'::jsonb,
  pdf_blob_url        TEXT,

  signer_name         TEXT,
  signature_type      TEXT CHECK (signature_type IN ('TYPED', 'DRAWN')),
  -- The typed name, or a data: URL of the drawn path.
  signature_data      TEXT,
  -- Affirmative consent to transact electronically. Separate from the signature
  -- itself, because ESIGN treats them as two different acts.
  consent_electronic  BOOLEAN NOT NULL DEFAULT false,

  signed_at           TIMESTAMPTZ,
  signed_ip           TEXT,
  signed_user_agent   TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT worker_agreements_signed_check CHECK (
    status <> 'SIGNED'
    OR (signed_at IS NOT NULL AND signer_name IS NOT NULL AND consent_electronic = true)
  )
);

CREATE INDEX IF NOT EXISTS worker_agreements_owner_idx
  ON worker_agreements (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS worker_agreements_worker_idx
  ON worker_agreements (worker_user_id, created_at DESC)
  WHERE worker_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS worker_agreements_invite_idx
  ON worker_agreements (invite_id)
  WHERE invite_id IS NOT NULL;

-- One pending agreement per invite: re-sending an invite must not stack up contracts.
CREATE UNIQUE INDEX IF NOT EXISTS worker_agreements_invite_pending_uidx
  ON worker_agreements (invite_id)
  WHERE invite_id IS NOT NULL AND status = 'PENDING';

COMMENT ON TABLE worker_agreements IS
  'Signed employment/contractor terms. rendered_body and body_sha256 freeze what was agreed to.';
COMMENT ON COLUMN worker_agreements.rendered_body IS
  'The fully interpolated agreement as shown at signing. Never regenerated.';
COMMENT ON COLUMN worker_agreements.body_sha256 IS
  'Fingerprint of rendered_body — proves which words were agreed to if the template later changes.';
COMMENT ON COLUMN worker_agreements.consent_electronic IS
  'Affirmative consent to transact electronically (ESIGN/UETA), recorded separately from the signature.';

-- Widen team invites so one path can carry terms for techs too. The old CHECK allowed
-- only 'receptionist', which is why field techs were invited through an entirely
-- separate stub-user flow.
ALTER TABLE team_invites DROP CONSTRAINT IF EXISTS team_invites_role_check;
ALTER TABLE team_invites
  ADD CONSTRAINT team_invites_role_check CHECK (role IN ('receptionist', 'field_tech'));
