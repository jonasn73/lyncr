# Lyncr Mobile (Expo)

React Native app for Lyncr. It uses the **same Next.js backend** as the web app at [lyncr.app](https://lyncr.app).

**Tap to Pay on iPhone** needs a native EAS build — not Safari and not Expo Go. See:

- [`docs/MOBILE-EAS-DEV-BUILD.md`](../docs/MOBILE-EAS-DEV-BUILD.md)
- [`docs/TAP-TO-PAY-IPHONE.md`](../docs/TAP-TO-PAY-IPHONE.md)

## Identifiers

| Field | Value |
|-------|--------|
| App name | Lyncr |
| Expo slug | `lyncr-mobile` |
| iOS bundle id | `app.lyncr.mobile` |
| Android package | `app.lyncr.mobile` |
| URL scheme | `lyncr` |
| API (production) | `https://lyncr.app` |

## How it works

- **Backend**: Next.js API routes in the parent repo (`/api/auth/*`, `/api/payments/*`, etc.).
- **Mobile**: Expo Router UI. Auth uses **cookies** (`credentials: 'include'`).
- **Collect tab**: Stripe Terminal React Native → Tap to Pay → same payment APIs as web Collect Payment.

## Quick start (UI only — Expo Go)

1. From repo root, API can be local or production. For production:

   ```bash
   cd /Users/JR/Desktop/Lyncr/mobile
   cp .env.example .env
   ```

   `.env` should contain:

   ```
   EXPO_PUBLIC_API_URL=https://lyncr.app
   ```

2. Install and start:

   ```bash
   cd /Users/JR/Desktop/Lyncr/mobile
   npm install
   npx expo start
   ```

   Expo Go is fine for login/tabs demos. **It will not run Tap to Pay.**

## Tap to Pay (development build)

```bash
npm install -g eas-cli
cd /Users/JR/Desktop/Lyncr/mobile
eas login
eas build:configure
npm run eas:dev:ios
```

Then:

```bash
npx expo start --dev-client
```

Install the build on a physical iPhone, open **Collect**, charge with NFC.

## Project structure

- `app/(tabs)/collect.tsx` — Collect Payment + Tap to Pay
- `app/(tabs)/` — Routing, Activity, Contacts, Pay, Settings
- `lib/api.ts` — `API_URL` (default `https://lyncr.app`), `apiGet`, `apiMutate`
- `eas.json` — EAS development / preview / production profiles

## Production App Store

Follow [`docs/DEPLOY-TO-APP-STORE.md`](../docs/DEPLOY-TO-APP-STORE.md).
