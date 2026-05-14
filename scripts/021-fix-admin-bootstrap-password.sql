-- ============================================
-- OPTIONAL — Fix admin@getzingapp.com password (wrong hash in older 020)
-- ============================================
-- If login says "Invalid email or password" for admin@getzingapp.com / admin after
-- running an older copy of `020-bootstrap-admin-getzingapp.sql`, the bundled bcrypt
-- string did not match `admin`. Run this once in Neon SQL Editor (same DB as Vercel
-- DATABASE_URL), then try logging in again.

UPDATE users
SET password_hash = '$2a$10$mU5OAacSA28h1434ybixXeZVyzSWL79TSOsgM3i46TaZdONv1X/R6',
    is_platform_admin = true
WHERE lower(email) = lower('admin@getzingapp.com');

-- Expect: UPDATE 1. If UPDATE 0, the user row does not exist — run the full
-- `020-bootstrap-admin-getzingapp.sql` from the repo (it now contains the correct hash).
