# Hold music

Busy “stay on the line” plays bundled **royalty-free** Lyncr-authored loops (synthetic ambient — no third-party samples):

| Preset | File (8 kHz mono WAV) |
|--------|------------------------|
| Calm (default) | `hold-calm.wav` / `hold-music.wav` |
| Upbeat | `hold-upbeat.wav` |
| Minimal | `hold-minimal.wav` |

**8 kHz mono WAV** is preferred for Telnyx Call Control / PSTN.  
(Earlier 16 kHz MPEG-2 MP3 files returned API-ok then `gatherStatus=invalid` in ~1s — callers heard silence.)

Pick a preset under **Lines → Greetings → Hold music**. **Custom URL…** (Advanced) accepts any public HTTPS MP3/WAV.

## How playback works

1. Busy gather **timeout** (stay on the line) → **`playback_start` with `loop: infinity`** (music first), then Telnyx `enqueue`, then DTMF `gather` for Press 1.
2. If URL playback fails, Lyncr sends the short Calm clip as Telnyx **`playback_content`** (base64) so Telnyx never has to fetch lyncr.app.
3. Optional: upload the WAV in Telnyx Mission Control → Media and set `LYNCR_HOLD_MUSIC_MEDIA_NAME=lyncr-hold-calm`.
4. `call.enqueued` is a **recovery restart** if enqueue cleared media.
5. Caller hangup (`gatherStatus=call_hangup`) does **not** enter hold.

Files must be public HTTPS that Telnyx can GET (e.g. `https://lyncr.app/audio/hold-calm.wav`).

Env overrides (optional):

```bash
LYNCR_HOLD_MUSIC_URL=https://your-cdn.example/hold-music.wav
LYNCR_HOLD_MUSIC_MEDIA_NAME=lyncr-hold-calm
```

Per-account values are stored in Neon (`account_settings.hold_music_url`, migration `129-call-queue.sql`) as either `/audio/hold-*.wav` or a full `https://…` URL.

**Verify in Vercel logs** after a Busy stay-on-line call:

- `telnyx-cc-hold-entered` with `musicStarted: true`
- `telnyx-cc-hold-music-started` with `mode: "playback_start+gather"` (or `playback_content` / `media_name`)

**License note:** The bundled files are original Lyncr-generated tone loops (not scraped from commercial libraries). You may replace them with any clearly licensed royalty-free track; keep attribution in this README if you swap in third-party audio.
