# Deploy lyncr to the App Store (and Google Play)

You have two parts:

1. **Web/API (Next.js)** – Your backend and web app. Deploy this first so the mobile app has an API to call.
2. **Mobile app (Expo)** – The app in `mobile/` that you submit to the **Apple App Store** (and optionally **Google Play**).

---

## Part 1: Deploy the web app (do this first)

The mobile app uses `EXPO_PUBLIC_API_URL` to talk to your API. So your Next.js app must be live first.

**Recommended: Vercel (free tier)**

1. Push your code to **GitHub** (if you haven’t already).
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
3. Click **Add New → Project**, choose your `zing` repo.
4. Set **Root Directory** to `.` (project root, not `mobile`).
5. Add **Environment Variables** (same as `.env.local`):
   - `DATABASE_URL`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `NEXT_PUBLIC_APP_URL` = `https://your-app.vercel.app` (Vercel will show the URL)
   - Optional: `PORTING_WEBHOOK_SECRET`, `OPENAI_API_KEY`, etc.
6. Deploy. After deploy, note your URL, e.g. `https://zing-xxx.vercel.app`.

---

## Part 2: Apple App Store (iOS)

### What you need

- **Apple Developer account** – [$99/year](https://developer.apple.com/programs/).
- **Mac** – For running EAS CLI and (if you build locally) Xcode.
- **Expo EAS** – Expo’s cloud build/submit service (free tier is enough to start).

### Step 1: Install EAS CLI

In a terminal (from your computer, not inside the mobile app yet):

```bash
npm install -g eas-cli
```

Log in to Expo:

```bash
eas login
```

(Create an Expo account at [expo.dev](https://expo.dev) if you don’t have one.)

### Step 2: Point the mobile app at your API

In `mobile/`, create or edit `.env` (or set in EAS):

```bash
EXPO_PUBLIC_API_URL=https://your-app.vercel.app
```

Use the **real** URL from Part 1 (no trailing slash). Reuse this value when configuring EAS (see below).

### Step 3: Configure the project for EAS

From the **mobile app folder** (where `app.json` and the Expo app live):

```bash
cd /Users/JR/Desktop/zing/mobile
eas build:configure
```

Choose the defaults if you’re not sure. This creates `eas.json` in `mobile/`.

Add your live API URL to the production profile. Edit `mobile/eas.json` and set `EXPO_PUBLIC_API_URL` in the env for the production build, for example:

```json
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal", "ios": { "simulator": true } },
    "production": {
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_API_URL": "https://your-app.vercel.app"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

Replace `https://your-app.vercel.app` with your real Next.js app URL from Part 1.

### Step 4: Build the iOS app

From the **mobile** folder:

```bash
cd /Users/JR/Desktop/zing/mobile
eas build --platform ios --profile production
```

EAS will build in the cloud. When it finishes, you’ll get a link to the build (and optionally a `.ipa` download).

### Step 5: Connect to Apple and submit

From the **mobile** folder:

```bash
cd /Users/JR/Desktop/zing/mobile
eas submit --platform ios --profile production
```

EAS will:

- Ask you to log in with your **Apple Developer** account (or create an App Store Connect app).
- Use the **latest production build** and upload it to App Store Connect.

After the upload:

1. Open [App Store Connect](https://appstoreconnect.apple.com).
2. Select your app (or create it if EAS created a placeholder).
3. Fill in **App Information**: name (lyncr), subtitle, category (e.g. Business), privacy policy URL.
4. Add **Screenshots** (required): iPhone 6.7", 6.5", 5.5" (Expo has guides; you can use simulator or a device).
5. Set **Pricing** (e.g. Free).
6. Submit the version for **Review**.

Apple usually reviews within 24–48 hours. Once approved, you can release to the App Store.

---

## Part 3: Google Play (Android, optional)

1. Create a [Google Play Developer account](https://play.google.com/console) (one-time $25).
2. From the **mobile** folder, build the Android app:

   ```bash
   cd /Users/JR/Desktop/zing/mobile
   eas build --platform android --profile production
   ```

3. Submit:

   ```bash
   eas submit --platform android --profile production
   ```

4. In Google Play Console, create the app, fill in store listing, screenshots, and content rating, then publish.

---

## Checklist

- [ ] Next.js app deployed (e.g. Vercel) and `NEXT_PUBLIC_APP_URL` / `EXPO_PUBLIC_API_URL` set.
- [ ] Apple Developer account ($99/year).
- [ ] `eas login` and `eas build:configure` (and `EXPO_PUBLIC_API_URL` in EAS env or `.env`).
- [ ] `eas build --platform ios --profile production`.
- [ ] `eas submit --platform ios --profile production`.
- [ ] App Store Connect: metadata, screenshots, pricing, submit for review.

For more detail, see Expo’s docs: [Submit to the Apple App Store](https://docs.expo.dev/submit/ios/) and [EAS Build](https://docs.expo.dev/build/introduction/).
