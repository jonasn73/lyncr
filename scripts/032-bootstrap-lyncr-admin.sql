-- Bootstrap platform admin: admin@lyncr.app (password: admin — change after first login).
-- Run in Neon SQL Editor after scripts/031-revoke-legacy-platform-admins.sql.

DO $$
DECLARE
  v_id uuid;
  -- bcrypt hash for literal password: admin (bcryptjs, 10 rounds) — verified with bcrypt.compare
  v_hash text := '$2a$10$hxrv3oLdHlP9z28RwUemLOI/NWcix99WMEgGMKNAU2PYJXqJz85hq';
BEGIN
  SELECT id INTO v_id FROM users WHERE lower(trim(email)) = lower('admin@lyncr.app');
  IF v_id IS NULL THEN
    INSERT INTO users (id, email, name, phone, business_name, password_hash, is_platform_admin, created_at)
    VALUES (
      gen_random_uuid(),
      'admin@lyncr.app',
      'Lyncr Admin',
      '+10000000001',
      'Lyncr Platform',
      v_hash,
      true,
      now()
    )
    RETURNING id INTO v_id;
    INSERT INTO routing_config (id, user_id, selected_receptionist_id, fallback_type, ai_greeting, ring_timeout_seconds, updated_at)
    VALUES (gen_random_uuid(), v_id, NULL, 'owner', '', 30, now());
    INSERT INTO onboarding_profiles (user_id, has_active_subscription, subscription_tier, updated_at)
    VALUES (v_id, true, 'business', now())
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    UPDATE users
    SET password_hash = v_hash,
        is_platform_admin = true,
        name = coalesce(nullif(trim(name), ''), 'Lyncr Admin')
    WHERE id = v_id;
  END IF;
END $$;
