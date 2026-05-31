# Test lyncr Without Local Postgres

You can use a **free cloud Postgres** so you don't need to install anything.

## Still seeing "password authentication failed for user postgres"?

Your `.env.local` is still using the local Postgres URL. Replace the `DATABASE_URL=...` line with your Neon URI from neon.tech (Connection string → URI), then run `npm run db:schema` and `npm run dev`.

---

## Option 1: Neon (recommended, ~2 minutes)

1. **Sign up**
   - Go to **https://neon.tech**
   - Sign up (free, no credit card for the free tier).

2. **Create a project**
   - Click **New Project**.
   - Pick a name (e.g. `zing`) and region, then create.

3. **Copy the connection string**
   - On the project dashboard you’ll see **Connection string**.
   - Choose **URI** and copy it. It looks like:
     ```text
     postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
     ```

4. **Put it in `.env.local`**
   - In your **project root** (the folder with `package.json` and `app/`), open or create `.env.local`.
   - Set `DATABASE_URL` to that string (one line, no quotes unless your password has special characters):
     ```bash
     DATABASE_URL=postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
     ```
   - Save the file.

5. **Create the tables**
   - In the project root, run:
     ```bash
     npm run db:schema
     ```
   - You should see: `Schema applied successfully.`

6. **Start the app**
   ```bash
   npm run dev
   ```
   - Open http://localhost:3000 and sign up; it will use the cloud database.

---

## Option 2: Supabase

1. Go to **https://supabase.com** and create a free account and project.
2. In the project: **Settings → Database**.
3. Copy the **Connection string** (URI format). Use the **Session mode** or **Transaction** URI; it includes the password.
4. Put it in `.env.local` as `DATABASE_URL=...` (add `?sslmode=require` at the end if it’s not there).
5. Run `npm run db:schema` from the project root, then `npm run dev`.

---

## If you already have a `.env.local` with Postgres

- Replace the old `DATABASE_URL=postgresql://.../zing` line with the new cloud connection string.
- Run `npm run db:schema` once, then `npm run dev`.

You do **not** need Postgres installed on your computer when using Neon or Supabase.
