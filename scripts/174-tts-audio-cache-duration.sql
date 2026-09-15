-- TTS audio cache duration — Neon migration 174
-- Run in Neon → SQL Editor after deploy. Agents cannot apply this for you.
-- The Busy-greeting cache-hit path pairs playback_start (the cached clip) with a separate
-- gather whose timeout has to roughly match the clip's real length, or callers either get
-- cut off mid-sentence (timeout too short) or sit in dead air after the clip ends before
-- hold music kicks in (timeout too long — what an estimate from character count produced).
-- Store the clip's real measured duration at render time so the gather can use it exactly.

ALTER TABLE tts_audio_cache
  ADD COLUMN IF NOT EXISTS duration_ms integer;

COMMENT ON COLUMN tts_audio_cache.duration_ms IS
  'Measured playback duration of the stored clip, in milliseconds — computed from the encoded file size at render time, not estimated from text length.';
