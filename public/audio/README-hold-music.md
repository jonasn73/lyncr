# Hold music

Busy “stay on the line” plays bundled **royalty-free** Lyncr-authored **classic call-center** loops (smooth elevator / light instrumental — not beeps or experimental noise):

| Preset | File (8 kHz mono WAV) |
|--------|------------------------|
| Classic hold (default) | `hold-calm.wav` / `hold-music.wav` |
| Bright hold | `hold-upbeat.wav` |
| Soft hold | `hold-minimal.wav` |

**8 kHz mono WAV** is preferred for Telnyx Call Control / PSTN.

Pick a preset under **Lines → Greetings → Hold music**. **Custom URL…** (Advanced) accepts any public HTTPS MP3/WAV.

## How playback works

1. Busy gather **timeout** (stay on the line) → **`playback_start` with `loop: infinity` immediately** (inline base64 first for lowest latency), then Neon `call_queue` for Lines Answer.
2. Soft-hold does **not** use Telnyx `enqueue` (that delayed/cleared media). Answer bridges by stored `call_control_id`.
3. About every **60 seconds**, a **short** reminder: “You're still in line. Press 1 to book by text…” — same script every time, then music resumes. Not a second full Busy greeting.
4. Optional: upload the WAV in Telnyx Mission Control → Media and set `LYNCR_HOLD_MUSIC_MEDIA_NAME=lyncr-hold-calm`.
5. Caller hangup (`gatherStatus=call_hangup`) does **not** enter hold.

Files must be public HTTPS that Telnyx can GET (e.g. `https://lyncr.app/audio/hold-calm.wav`).

Env overrides (optional):

```bash
LYNCR_HOLD_MUSIC_URL=https://your-cdn.example/hold-music.wav
LYNCR_HOLD_MUSIC_MEDIA_NAME=lyncr-hold-calm
LYNCR_HOLD_REPROMPT_MS=60000
```

**Verify in Vercel logs** after a Busy stay-on-line call:

- `telnyx-cc-hold-entered` with `musicStarted: true` and `softHoldNoTelnyxEnqueue: true`
- `telnyx-cc-hold-music-started` with `mode: "playback_content"` (or `playback_start+gather`)

**License note:** The bundled files are original Lyncr-generated instrumental loops (not scraped from commercial libraries). You may replace them with any clearly licensed royalty-free track; keep attribution in this README if you swap in third-party audio.
