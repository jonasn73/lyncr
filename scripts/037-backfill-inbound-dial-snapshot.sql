-- Backfill inbound_dial_e164 when snapshot timestamp exists but dial target is empty.
-- Run in Neon SQL Editor after scripts/036 (see scripts/MIGRATE-ALL.md step 37).

UPDATE phone_numbers pn
SET
  inbound_receptionist_id = resolved.selected_receptionist_id,
  inbound_dial_e164 = NULLIF(trim(COALESCE(resolved.receptionist_phone, resolved.owner_phone)), ''),
  inbound_receptionist_name = resolved.receptionist_name,
  inbound_fallback_type = resolved.fallback_type,
  inbound_ring_timeout_seconds = resolved.ring_timeout_seconds,
  inbound_account_status = resolved.account_status,
  inbound_ai_ring_owner_first = resolved.ai_ring_owner_first,
  inbound_routing_updated_at = now()
FROM (
  SELECT
    pn2.id AS phone_id,
    COALESCE(
      CASE
        WHEN rc_spec.id IS NOT NULL AND rc_spec.selected_receptionist_id IS NOT NULL THEN rc_spec.selected_receptionist_id
      END,
      rc_def.selected_receptionist_id
    ) AS selected_receptionist_id,
    reff.phone AS receptionist_phone,
    reff.name AS receptionist_name,
    u.phone AS owner_phone,
    COALESCE(
      CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.fallback_type ELSE rc_def.fallback_type END,
      'owner'
    ) AS fallback_type,
    COALESCE(
      CASE WHEN rc_spec.id IS NOT NULL THEN rc_spec.ring_timeout_seconds ELSE rc_def.ring_timeout_seconds END,
      30
    ) AS ring_timeout_seconds,
    COALESCE(op.account_status, 'active') AS account_status,
    COALESCE(rc_def.ai_ring_owner_first, false) AS ai_ring_owner_first
  FROM phone_numbers pn2
  JOIN users u ON u.id = pn2.user_id
  LEFT JOIN onboarding_profiles op ON op.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT rc.*
    FROM routing_config rc
    WHERE rc.user_id = u.id
      AND rc.business_number IS NOT NULL
      AND (
        rc.business_number = pn2.number
        OR regexp_replace(COALESCE(rc.business_number, ''), '\D', '', 'g') = regexp_replace(pn2.number, '\D', '', 'g')
        OR (
          length(regexp_replace(COALESCE(rc.business_number, ''), '\D', '', 'g')) >= 10
          AND length(regexp_replace(pn2.number, '\D', '', 'g')) >= 10
          AND right(regexp_replace(COALESCE(rc.business_number, ''), '\D', '', 'g'), 10)
            = right(regexp_replace(pn2.number, '\D', '', 'g'), 10)
        )
      )
    ORDER BY rc.updated_at DESC NULLS LAST
    LIMIT 1
  ) rc_spec ON true
  LEFT JOIN routing_config rc_def
    ON rc_def.user_id = u.id
    AND rc_def.business_number IS NULL
  LEFT JOIN receptionists reff ON reff.id = COALESCE(
    CASE
      WHEN rc_spec.id IS NOT NULL AND rc_spec.selected_receptionist_id IS NOT NULL THEN rc_spec.selected_receptionist_id
    END,
    rc_def.selected_receptionist_id
  )
  WHERE pn2.status = 'active'
) resolved
WHERE pn.id = resolved.phone_id
  AND pn.status = 'active';

-- Verify (inbound_dial_e164 should show +1… receptionist cell):
-- SELECT number, inbound_dial_e164, inbound_receptionist_name, inbound_routing_updated_at
-- FROM phone_numbers WHERE status = 'active';
