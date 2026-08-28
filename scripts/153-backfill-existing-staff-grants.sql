-- One-time: give existing staff what they can already do, before the grants start applying.
--
-- Every capability defaults to FALSE, which is right for someone hired tomorrow and wrong
-- for everyone already working today. Without this, the deploy that turns the permission
-- model on is also the deploy where:
--
--   every receptionist loses her intake form mid-shift
--   every field tech loses the job pool, their wallet, and the ability to take payment
--
-- Nobody asked for that; it is just the defaults landing on people who predate them. So
-- this grants exactly what each role had the day before, and nothing they did not. From
-- then on the owner adds and removes deliberately.
--
-- Run AFTER 150, 151 and 152, and BEFORE (or with) the deploy that ships the model.
-- Idempotent: re-running sets the same values.

-- Receptionists took intake on every call. Only that — the CRM, scheduler and invoicing
-- surfaces in 150 are genuinely new, and nobody had them yesterday.
UPDATE receptionists
SET capabilities = coalesce(capabilities, '{}'::jsonb) || '{"call_intake": true}'::jsonb;

-- Field techs had the whole console: claim from the pool, call the customer, take payment,
-- see their wallet. All four were unconditional before 152.
UPDATE field_technicians
SET capabilities = coalesce(capabilities, '{}'::jsonb) || '{
  "job_pool": true,
  "customer_contact": true,
  "collect_payment": true,
  "view_earnings": true
}'::jsonb;

-- Account ceilings are intentionally NOT touched: absent already means granted, so every
-- existing business keeps everything until an admin revokes something.
