# In-app Support chat (tenant ↔ admin)

## What it is

Business owners chat with Lyncr from **Dashboard → Help & feedback**.
Platform admin (`admin@lyncr.app`) replies under **Admin → Support → Live chat**.

Emails (Resend inbox) and In-app feedback tabs are unchanged.

## Neon (required)

1. Open **Neon → SQL Editor**
2. Paste and run the full contents of `scripts/128-support-chat.sql`
3. Confirm tables exist: `support_chat_threads`, `support_chat_messages`, `support_chat_attachments`

## Env (attachments)

1. In Vercel → **Storage** → create a **Blob** store (or open an existing one)
2. Copy **`BLOB_READ_WRITE_TOKEN`** into the project Environment Variables (Production)
3. Redeploy after adding the token

Without the Blob token, text chat still works; file upload returns a clear error.

## Notify owner on admin reply

- In-app: floating banner on the dashboard + unread count when Help chat is open
- Email: uses existing **`RESEND_API_KEY`** / **`RESEND_FROM_EMAIL`** (same as invites)

## Hard refresh

After deploy, hard-refresh the browser (Cmd+Shift+R) so the new Help chat UI loads.
