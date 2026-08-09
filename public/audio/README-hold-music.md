# Hold music

Busy “stay on the line” plays bundled **royalty-free** Lyncr-authored **classic call-center** loops (smooth elevator / soft jazz voicings — not beeps or experimental noise):

| Preset | File (8 kHz mono WAV) |
|--------|------------------------|
| Classic hold (default) | `hold-calm.wav` / `hold-music.wav` |
| Bright hold | `hold-upbeat.wav` |
| Soft hold | `hold-minimal.wav` |
| Inline (low-latency) | `hold-calm-short.wav` (~8s, used as `playback_content`) |

**8 kHz mono WAV** is preferred for Telnyx Call Control / PSTN.

Pick a preset under **Lines → Greetings → Hold music**. **Custom URL…** (Advanced) accepts any public HTTPS MP3/WAV.

## How playback works

1. Busy gather speaks the full greeting **once** (`maximum_tries: 1`). Telnyx’s default is 3 — that used to replay Busy three times before music.
2. On timeout / stay on the line → **`playback_start` with `loop: infinity` immediately** (inline base64 first), then Neon `call_queue` for Lines Answer.
3. Soft-hold does **not** use Telnyx `enqueue` (that delayed/cleared media). Answer bridges by stored `call_control_id`.
4. About every **60 seconds**, a **short** reminder once (`maximum_tries: 1`): “You're still in line. Press 1 to book by text…” with the **same NaturalHD / persona voice** as Busy, then music resumes. Never a second full Busy greeting.
5. Optional: upload the WAV in Telnyx Mission Control → Media and set `LYNCR_HOLD_MUSIC_MEDIA_NAME=lyncr-hold-calm`.
6. Caller hangup (`gatherStatus=call_hangup`) does **not** enter hold.

Files must be public HTTPS that Telnyx can GET (e.g. `https://lyncr.app/audio/hold-calm.wav`).

Env overrides (optional):

```bash
LYNCR_HOLD_MUSIC_URL=https://your-cdn.example/hold-music.wav
LYNCR_HOLD_MUSIC_MEDIA_NAME=lyncr-hold-calm
LYNCR_HOLD_REPROMPT_MS=60000
```

**Verify in Vercel logs** after a Busy stay-on-line call:

- `telnyx-cc-busy-automation-gather` with `maximumTries: 1`
- `telnyx-cc-hold-entered` with `musicStarted: true` and `softHoldNoTelnyxEnqueue: true`
- `telnyx-cc-hold-music-started` with `mode: "playback_content"` (or `playback_start+gather`)
- `telnyx-cc-hold-reprompt-speak` with `speakVoice: "Telnyx.NaturalHD.astra"` (or the account persona)

**License note:** Bundled files are original Lyncr-generated instrumental loops (soft jazz / elevator voicings, not scraped from commercial libraries). You may replace them with any clearly licensed royalty-free track; keep attribution in this README if you swap in third-party audio.
