# Deploy Lyncr to the App Store (and Google Play)

You have two parts:

1. **Web/API (Next.js)** – Backend and web app on Vercel ([lyncr.app](https://lyncr.app)). Deploy this first so the mobile app has an API to call.
2. **Mobile app (Expo)** – The app in `mobile/` that you submit to the **Apple App Store** (and optionally **Google Play**).

For Tap to Pay on iPhone, also read [`TAP-TO-PAY-IPHONE.md`](./TAP-TO-PAY-IPHONE.md) and [`MOBILE-EAS-DEV-BUILD.md`](./MOBILE-EAS-DEV-BUILD.md).

---

## Part 1: Deploy the web app (do this first)

The mobile app uses `EXPO_PUBLIC_API_URL` to talk to your API. Production builds already use `https://lyncr.app` via `mobile/eas.json`.

**Recommended: Vercel**

1. Push your code to **GitHub**.
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
3. Use the linked **Lyncr** project (or **Add New → Project** and choose this repo).
4. Set **Root Directory** to `.` (project root, not `mobile`).
5. Add **Environment Variables** (same as production): `DATABASE_URL`, Stripe keys, Telnyx, `NEXT_PUBLIC_APP_URL=https://lyncr.app`, etc.
6. Optional for Terminal: `STRIPE_TERMINAL_LOCATION_ID=tml_…`
7. Deploy. Production URL: `https://lyncr.app`.

---

## Part 2: Apple App Store (iOS)

### What you need

- **Apple Developer account** – [$99/year](https://developer.apple.com/programs/).
- **Tap to Pay on iPhone entitlement** – see [`TAP-TO-PAY-IPHONE.md`](./TAP-TO-PAY-IPHONE.md).
- **Expo EAS** – cloud build/submit ([expo.dev](https://expo.dev)).

### Step 1: Install EAS CLI

```bash
npm install -g eas-cli
eas login
```

### Step 2: Point the mobile app at your API

Production EAS profiles already set:

```bash
EXPO_PUBLIC_API_URL=https://lyncr.app
```

For local Metro against production, copy `mobile/.env.example` → `mobile/.env`.

### Step 3: Configure the project for EAS

```bash
cd /Users/JR/Desktop/Lyncr/mobile
eas build:configure
```

Bundle identifier: **`app.lyncr.mobile`**. Commit any `projectId` EAS writes into `app.json`.

### Step 4: Development build (test Tap to Pay on device)

```bash
cd /Users/JR/Desktop/Lyncr/mobile
npm run eas:dev:ios
```

Install on your iPhone, then `npx expo start --dev-client`. Open the **Collect** tab.

### Step 5: Production build

```bash
cd /Users/JR/Desktop/Lyncr/mobile
npm run eas:prod:ios
```

### Step 6: Submit to App Store Connect

```bash
cd /Users/JR/Desktop/Lyncr/mobile
eas submit --platform ios --profile production
```

Then in [App Store Connect](https://appstoreconnect.apple.com):

1. App name: **Lyncr**
2. Privacy policy URL, screenshots, category (Business)
3. Disclose Tap to Pay / in-person payments
4. Submit for review

---

## Part 3: Google Play (Android, optional)

```bash
cd /Users/JR/Desktop/Lyncr/mobile
eas build --platform android --profile production
eas submit --platform android --profile production
```

Android Tap to Pay can follow later with the same Expo app.

---

## Checklist

- [ ] Next.js live at `https://lyncr.app` with Stripe configured
- [ ] Apple Developer + Tap to Pay entitlement on `app.lyncr.mobile`
- [ ] `eas login` and `eas build:configure`
- [ ] Development build installed; Collect → Tap to Pay works on device
- [ ] `eas build --platform ios --profile production`
- [ ] `eas submit --platform ios --profile production`
- [ ] App Store Connect metadata + review

See also: [Expo iOS submit](https://docs.expo.dev/submit/ios/), [EAS Build](https://docs.expo.dev/build/introduction/), [`APP-STORE-READINESS.md`](./APP-STORE-READINESS.md).
