# Hold music

Busy “stay on the line” plays bundled **royalty-free** Lyncr-authored WAV loops (synthetic ambient — no third-party samples):

| Preset | File |
|--------|------|
| Calm (default) | `hold-calm.wav` / `hold-music.wav` |
| Upbeat | `hold-upbeat.wav` |
| Minimal | `hold-minimal.wav` |

Pick a preset under **Lines → Greetings → Hold music**. **Custom URL…** (Advanced) accepts any public HTTPS MP3/WAV.

Env override (optional):

```bash
LYNCR_HOLD_MUSIC_URL=https://your-cdn.example/hold-music.mp3
```

Per-account values are stored in Neon (`account_settings.hold_music_url`, migration `129-call-queue.sql`) as either `/audio/hold-*.wav` or a full `https://…` URL.

**License note:** The bundled WAV files are original Lyncr-generated tone loops (not scraped from commercial libraries). You may replace them with any clearly licensed royalty-free track; keep attribution in this README if you swap in third-party audio.
