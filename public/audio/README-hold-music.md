# Hold music

Place a **royalty-free** MP3 or WAV here as `hold-music.mp3` so Busy “stay on the line” can play it.

Or set a public HTTPS URL in Vercel:

```bash
LYNCR_HOLD_MUSIC_URL=https://your-cdn.example/hold-music.mp3
```

You can also set a per-account URL under **Greetings → Hold music URL** (requires Neon migration `129-call-queue.sql`).

Env wins over the account setting when both are set.
