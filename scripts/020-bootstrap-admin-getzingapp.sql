-- ============================================
-- OPTIONAL — Bootstrap platform admin (getzingapp.com)
-- ============================================
-- Creates or updates `admin@getzingapp.com` with password **admin** (bcrypt cost 10).
-- This bypasses the app's signup rule (min 8 characters) on purpose for a controlled bootstrap.
--
-- SECURITY: Change this password immediately after first login (Settings → or run another UPDATE).
-- Do not commit real production secrets; rotate if this file ever leaked.
--
-- Run in Neon → SQL Editor after core migrations (001–019 as needed).
-- Also set Vercel env `ZING_ADMIN_EMAILS=admin@getzingapp.com` if you want env-based admin access
-- in addition to `is_platform_admin` (this script sets the DB flag to true).

DO $$
DECLARE
  v_id uuid;
-- bcrypt hash for literal password: admin (bcryptjs, 10 rounds) — verified with bcrypt.compare
  v_hash text := '$2a$10$hxrv3oLdHlP9z28RwUemLOI/NWcix99WMEgGMKNAU2PYJXqJz85hq';
BEGIN
  SELECT id INTO v_id FROM users WHERE lower(email) = lower('admin@getzingapp.com');
  IF v_id IS NULL THEN
    INSERT INTO users (id, email, name, phone, business_name, password_hash, created_at)
    VALUES (
      gen_random_uuid(),
      'admin@getzingapp.com',
      'Platform Admin',
      '+10000000000',
      'Zing',
      v_hash,
      now()
    )
    RETURNING id INTO v_id;
    INSERT INTO routing_config (id, user_id, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, updated_at)
    VALUES (gen_random_uuid(), v_id, NULL, 'owner', '', 30, now());
  END IF;
  UPDATE users
  SET password_hash = v_hash,
      is_platform_admin = true
  WHERE id = v_id;
END $$;
