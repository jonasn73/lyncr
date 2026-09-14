-- TTS audio cache — Neon migration 172
-- Run in Neon → SQL Editor after deploy. Agents cannot apply this for you.
-- Pre-render repeated IVR phrases (starting with the branded inbound greeting) once via
-- Telnyx TTS, store the resulting clip in Blob, and <Play> it on later calls instead of
-- paying live Telnyx TTS synthesis + latency on every single inbound call. Populated
-- lazily and best-effort from the call path — a lookup miss or write failure here must
-- never block a live call, it just falls back to the existing live <Say>.

CREATE TABLE IF NOT EXISTS tts_audio_cache (
  cache_key text PRIMARY KEY,
  blob_url text NOT NULL,
  voice text NOT NULL,
  spoken_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tts_audio_cache IS
  'Pre-rendered TTS clips keyed by sha256(text|voice|language). Populated lazily (fire-and-forget) on a cache miss during a live call, served via <Play> on later hits so repeat phrases skip live Telnyx TTS synthesis.';
