-- Fix admin@lyncr.app login when password "admin" fails (wrong bcrypt in older 032).
-- Run once in Neon SQL Editor (same DB as Vercel DATABASE_URL), then try /login again.

UPDATE users
SET password_hash = '$2a$10$hxrv3oLdHlP9z28RwUemLOI/NWcix99WMEgGMKNAU2PYJXqJz85hq',
    is_platform_admin = true
WHERE lower(trim(email)) = lower('admin@lyncr.app');

-- Expect: UPDATE 1. If UPDATE 0, run scripts/032-bootstrap-lyncr-admin.sql first (creates the account).
