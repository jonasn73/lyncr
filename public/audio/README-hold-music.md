# Hold music

Busy “stay on the line” plays bundled **royalty-free** Lyncr-authored loops (synthetic ambient — no third-party samples):

| Preset | File (preferred) | WAV twin (legacy) |
|--------|------------------|-------------------|
| Calm (default) | `hold-calm.mp3` | `hold-calm.wav` / `hold-music.*` |
| Upbeat | `hold-upbeat.mp3` | `hold-upbeat.wav` |
| Minimal | `hold-minimal.mp3` | `hold-minimal.wav` |

**MP3 is preferred** for Telnyx Call Control / PSTN. WAV twins remain for older stored URLs.

Pick a preset under **Lines → Greetings → Hold music**. **Custom URL…** (Advanced) accepts any public HTTPS MP3/WAV.

## How playback works

1. Busy gather **timeout** (stay on the line) → `enqueue` + **immediate** `gather_using_audio` with the music URL (Press 1 still works).
2. `call.enqueued` is a **recovery restart** only (not required for music to start).
3. Caller hangup (`gatherStatus=call_hangup`) does **not** enter hold.

Files must be public HTTPS that Telnyx can GET (e.g. `https://lyncr.app/audio/hold-calm.mp3`).

Env override (optional):

```bash
LYNCR_HOLD_MUSIC_URL=https://your-cdn.example/hold-music.mp3
```

Per-account values are stored in Neon (`account_settings.hold_music_url`, migration `129-call-queue.sql`) as either `/audio/hold-*.mp3` or a full `https://…` URL.

If every lyncr.app URL fails, Call Control tries a known-good public sample URL as last resort, then speak-only hold.

**License note:** The bundled files are original Lyncr-generated tone loops (not scraped from commercial libraries). You may replace them with any clearly licensed royalty-free track; keep attribution in this README if you swap in third-party audio.
