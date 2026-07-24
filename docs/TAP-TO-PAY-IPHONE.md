# Tap to Pay on iPhone (Lyncr mobile)

Safari and “Add to Home Screen” **cannot** use iPhone NFC as a card reader. Tap to Pay only works in a **native App Store / TestFlight / EAS development build** with:

1. Apple **Tap to Pay on iPhone** entitlement  
2. Stripe Terminal **React Native** SDK (`@stripe/stripe-terminal-react-native`)  
3. A physical **iPhone XS or later** (not the simulator for real NFC)

The Expo app lives in [`mobile/`](../mobile/). It calls the same APIs as web Collect Payment on [lyncr.app](https://lyncr.app).

---

## What is already wired in the repo

| Piece | Where |
|--------|--------|
| Bundle id | `app.lyncr.mobile` in `mobile/app.json` |
| Entitlement key | `com.apple.developer.proximity-reader.payment.acceptance` in `mobile/app.json` → `ios.entitlements` |
| Stripe Terminal config plugin | `mobile/app.json` → `plugins` |
| EAS profiles | `mobile/eas.json` (`EXPO_PUBLIC_API_URL=https://lyncr.app`) |
| Collect screen | `mobile/app/(tabs)/collect.tsx` |
| Connection token | `POST /api/payments/terminal/connection-token` |
| Terminal location | `GET /api/payments/terminal/location` (or `STRIPE_TERMINAL_LOCATION_ID` env) |
| Create / confirm charge | `POST /api/payments/create-intent`, `POST /api/payments/confirm` |

---

## 1. Apple Developer — request Tap to Pay entitlement

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year).
2. In [Apple Developer](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles** → **Identifiers**, create/select App ID **`app.lyncr.mobile`**.
3. Request **Tap to Pay on iPhone** capability / entitlement from Apple (Apple’s merchant / Tap to Pay enrollment — often under Additional Capabilities or via Apple’s entitlement request form). Approval can take days.
4. After approval, enable the capability on the App ID so provisioning profiles include:
   - `com.apple.developer.proximity-reader.payment.acceptance`
5. EAS will regenerate profiles on the next iOS build once the App ID has the capability.

Without this entitlement, discover/connect fails with errors like “command not allowed” even if the code is correct.

---

## 2. Stripe Dashboard

1. Complete Stripe Terminal / Tap to Pay onboarding for your account (test mode first is fine).
2. Optional but recommended: create a Terminal **Location** in Stripe Dashboard and set on Vercel:

   ```bash
   STRIPE_TERMINAL_LOCATION_ID=tml_xxxxxxxx
   ```

   If unset, the API creates/reuses a per-user Location automatically.

3. Ensure `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are set on Vercel (same as web Collect Payment).

---

## 3. EAS development build (required — not Expo Go)

Expo Go **cannot** load the Terminal native module. Build a **development client**:

```bash
npm install -g eas-cli
cd /Users/JR/Desktop/Lyncr/mobile
eas login
eas build:configure
npm run eas:dev:ios
```

When the build finishes:

1. Open the build page on [expo.dev](https://expo.dev) and install on your iPhone (QR / link; device must be registered for internal distribution).
2. Start the JS bundler against that install:

   ```bash
   cd /Users/JR/Desktop/Lyncr/mobile
   npx expo start --dev-client
   ```

3. Log in with your Lyncr account → **Collect** tab → enter amount → **Tap to Pay**.

See also [`docs/MOBILE-EAS-DEV-BUILD.md`](./MOBILE-EAS-DEV-BUILD.md) and [`docs/DEPLOY-TO-APP-STORE.md`](./DEPLOY-TO-APP-STORE.md).

---

## 4. TestFlight / App Store

1. Production build:

   ```bash
   cd /Users/JR/Desktop/Lyncr/mobile
   npm run eas:prod:ios
   eas submit --platform ios --profile production
   ```

2. In App Store Connect, fill privacy, screenshots, and disclose **in-person card payments / Tap to Pay**.
3. App Review may ask for a demo account and a short note that payments use Stripe Terminal + Tap to Pay on iPhone.

---

## 5. Privacy strings (already in `app.json`)

- Location (required by Stripe Terminal)  
- NFC usage description  
- Bluetooth / local network (for other reader types)

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Works in Safari web Collect but not on phone NFC | Expected — web cannot use Tap to Pay NFC |
| Module missing / crash in Expo Go | Need EAS development or production build |
| Entitlement / “not allowed” | Apple Tap to Pay entitlement not on App ID / profile |
| No reader / unsupported device | Simulator, or iPhone older than XS |
| 401 on create-intent | Log in again; cookies must reach `https://lyncr.app` |

---

## Out of scope for v1 phone ship

- Full Lines / Map / Scheduler parity with the web app  
- Android Tap to Pay (same Expo app can add later)  
- Replacing the Vercel web app
