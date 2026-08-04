# Admin support email inbox (Zoho-safe)

Lyncr’s admin console can show mail sent to **support@lyncr.app** under **Admin → Support → Emails**.

**Important:** Zoho already handles **admin@lyncr.app** and almost certainly owns **MX for lyncr.app**.  
**Do not** point the root domain’s MX at Resend. That would break Zoho mailboxes.

## Architecture (recommended)

1. Keep **Zoho** as the mail server for `@lyncr.app` (admin@, support@, etc.).
2. Create **support@lyncr.app** in Zoho (mailbox or alias).
3. Receive mail in Resend on a **subdomain only** (e.g. `inbound.lyncr.app`), **or** on Resend’s free `*.resend.app` address (no DNS).
4. In Zoho, **forward** support@ → that Resend address.
5. Resend posts `email.received` to Lyncr; Lyncr stores the message in Neon and shows it in admin.

| Option | What you do | DNS change |
|--------|-------------|------------|
| **A (simplest)** | Forward Zoho support@ → your Resend Receiving address (`…@….resend.app`) | None |
| **B (recommended long-term)** | Add MX only for `inbound.lyncr.app` → Resend; forward support@ → `support@inbound.lyncr.app` | Subdomain MX only |
| **C (do not)** | Put Resend MX on `lyncr.app` | Breaks Zoho — never |

---

## Exact setup steps

### 1. Neon (database)

1. Open [Neon Console](https://console.neon.tech) → your Lyncr project → **SQL Editor**.
2. Open the file `scripts/127-admin-support-emails.sql` in this repo.
3. Copy **all** of the SQL inside that file and paste it into Neon → **Run**.
4. Also listed in `scripts/MIGRATE-ALL.md` as migration **127**.

### 2. Vercel env vars

In **Vercel → Project → Settings → Environment Variables** (Production):

| Name | Value |
|------|--------|
| `RESEND_API_KEY` | Your existing Resend API key (`re_…`) — needed to fetch email body |
| `RESEND_WEBHOOK_SECRET` | Signing secret from the Resend webhook you create below (`whsec_…`) |
| `RESEND_INBOUND_ADDRESS` | (Optional) The address Zoho forwards to, e.g. `support@inbound.lyncr.app` or `support@….resend.app` — for your notes only |

Redeploy after saving env vars (or run `npm run deploy:vercel` after the code is live).

### 3. Resend — receiving + webhook

1. Go to [resend.com](https://resend.com) → log in.
2. **Option A (no DNS):**  
   - Emails → **Receiving** → three dots → **Receiving address**.  
   - Copy something like `something@cool-hedgehog.resend.app`.  
   - You’ll forward Zoho support@ to e.g. `support@cool-hedgehog.resend.app` (any local-part works on that domain).
3. **Option B (subdomain):**  
   - Domains → add **`inbound.lyncr.app`** (or enable **Receiving** on that subdomain).  
   - Resend shows an **MX** record — add it at your DNS host for host `inbound` (or `inbound.lyncr.app`), **not** for bare `lyncr.app`.  
   - Wait until Resend marks the domain verified / receiving ready.
4. **Webhooks** → **Add Webhook**:  
   - URL: `https://lyncr.app/api/webhooks/resend/inbound` (use your real production host if different).  
   - Event: **`email.received`**.  
   - Copy the **signing secret** → set as `RESEND_WEBHOOK_SECRET` in Vercel.

### 4. Zoho Mail — create support@ and forward

1. Sign in to [Zoho Mail Admin](https://mailadmin.zoho.com) (or Zoho Mail → Admin Console) for **lyncr.app**.
2. **Create support@** if it does not exist:  
   - **Users** → **Add User** (full mailbox), **or**  
   - **Users** → open **admin@lyncr.app** → **Email Alias** / **Alias** → add **support@lyncr.app**.
3. **Set up forwarding** to Resend:  
   - Open the **support@** mailbox (or the mailbox that owns the support@ alias).  
   - Go to **Settings** (gear) → **Mail Accounts** / **Email Forwarding** (wording varies: look for **Forwarding**).  
   - Add forward-to address:  
     - Option A: `support@YOUR-SUBDOMAIN.resend.app` (from Resend Receiving address), **or**  
     - Option B: `support@inbound.lyncr.app`.  
   - Save. Keep a copy in Zoho if you want (optional).
4. Send a test message from a personal email **to support@lyncr.app**.
5. Log into Lyncr as **admin@lyncr.app** → **Admin** → **Support** → **Emails**. The message should appear within a minute or two.

### 5. What does **not** conflict with Zoho

- Root **MX for lyncr.app** stays on Zoho → **admin@lyncr.app** keeps working.
- Only a **subdomain** MX (or no custom DNS if using `*.resend.app`) goes to Resend.
- Outbound Resend (`RESEND_FROM_EMAIL` / invites / receipts) is separate from inbound MX.

---

## Reply from admin

MVP is **read-only** (list + detail + mark read). In-app **Reply** is stubbed as “coming soon.” You can still reply from Zoho if you keep a copy there.
