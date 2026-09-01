-- 157: Real contact email for accounts whose `email` column is a synthetic placeholder.
--
-- Field techs are invited by mobile number only — users.email is `t{digits}@tech.lyncr.app`
-- (see lib/tech-invite.ts syntheticTechEmail), used as the lookup/dedup key in
-- lib/tech-invite-stub.ts and never a real deliverable address. Some receptionist SMS invites
-- are similarly synthesized (`sms_{digits}@sms.lyncr.app`, lib/invitations.ts). This column
-- holds an optional real address captured at invite time, purely so a signup-confirmation
-- email has somewhere to go — it is NOT used for login/uniqueness and is never a substitute
-- for `users.email`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email text;
