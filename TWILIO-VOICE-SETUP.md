# Telnyx voice setup - why AI did not answer

## What “Port” does in lyncr

When you use **Port Existing** and enter a number (e.g. 5025571219) that is already on your carrier account:

- lyncr **saves** that number in your account and shows it in Settings.
- It does **not** move the number from one carrier to another instantly.
- It does **not** automatically point that number to lyncr unless routing is configured.

So the number appears in Settings because it is in our database, but your carrier still receives the call unless voice routing is configured. For lyncr (and the AI) to handle calls, your Telnyx number must point to your lyncr webhook.

---

## What you need for AI to answer

1. **App must be on a public URL**  
   Telnyx cannot call `localhost`. Deploy the app (e.g. Vercel) and set `NEXT_PUBLIC_APP_URL` in `.env` to that URL (e.g. `https://your-app.vercel.app`).

2. **Point the number to lyncr in Telnyx**  
   - In Telnyx, open your phone number voice settings.
   - Set the voice connection to the lyncr TeXML app / webhook.
   - URL should resolve to `https://YOUR_DEPLOYED_URL/api/voice/telnyx/incoming` (or your compatibility route if configured).
   - Method: **POST**.
   - Save.

3. **Set fallback to AI in lyncr**  
   In the lyncr app, open the **Routing** (dashboard) screen and set **When no one answers** to **AI Assistant**. That makes unanswered calls go to the AI instead of only to you or voicemail.

After this, when someone calls your business number and no one answers, Telnyx will request your app fallback URL and lyncr will connect the call to AI.

---

## Code change made

- Numbers you add via **Port** are treated as routable even while status is **porting**, and the incoming number is normalized so lookup works whether the carrier sends `5025571219` or `+15025571219`.

If you want, we can next add a "Connect this number" step in the app that deep-links to your number config and shows your webhook URL in one place.
