# Fix "password authentication failed for user postgres"

Your app uses `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lyncr`.  
Postgres is rejecting the password. Use one of these fixes:

---

## Option 1: Set Postgres password to `postgres` (recommended for local dev)

Run **one** of these in your terminal (try in this order):

**If Postgres asks for a password when you run psql:**

```bash
psql -U postgres -h localhost -c "ALTER USER postgres PASSWORD 'postgres';"
```

(Enter your current postgres password when prompted, then restart the app.)

**On Mac with Homebrew Postgres (often no password by default):**

```bash
psql -U postgres -h localhost -c "ALTER USER postgres PASSWORD 'postgres';"
```

**If you get "role postgres does not exist" or need to use sudo:**

```bash
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
```

Then restart your app: stop the dev server (Ctrl+C) and run `npm run dev` again.

---

## Option 2: Use your real password in `.env.local`

If you know the postgres user’s password, put it in `.env.local`:

1. Open `.env.local` in the project root.
2. Find the line:  
   `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lyncr`
3. Replace the **second** `postgres` (the one after the colon) with your actual password, e.g.:  
   `DATABASE_URL=postgresql://postgres:YOUR_REAL_PASSWORD@localhost:5432/lyncr`
4. Save the file and restart the app (`npm run dev`).

---

## Option 3: Use a cloud database (Neon or Supabase)

1. Sign up at [neon.tech](https://neon.tech) or [supabase.com](https://supabase.com).
2. Create a project and copy the **connection string** (Postgres URL).
3. In `.env.local`, set:  
   `DATABASE_URL=<paste the connection string here>`
4. Run the schema once:  
   `psql "<your connection string>" -f scripts/001-create-schema.sql`  
   (or use the provider’s SQL editor to run the contents of `scripts/001-create-schema.sql`).
5. Restart the app.

---

After any option, try signing up again. If it still fails, the error message on the signup form should give a clue (e.g. "database does not exist" → create it with `createdb lyncr`).
