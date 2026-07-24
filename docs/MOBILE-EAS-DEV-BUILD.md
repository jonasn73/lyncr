# Lyncr iPhone — EAS development build

Use this to install a **real native Lyncr app** on your iPhone so **Tap to Pay** can run. Expo Go is only for UI demos without native Stripe Terminal.

## Prerequisites

- Apple Developer Program membership ($99/year)
- Physical iPhone (XS or later for Tap to Pay)
- Expo account ([expo.dev](https://expo.dev))
- Mac with Node 18+ (for CLI); builds run in the cloud via EAS

## One-time setup

Open Terminal and run these commands **exactly**:

```bash
npm install -g eas-cli
cd /Users/JR/Desktop/Lyncr/mobile
npm install
eas login
eas build:configure
```

`eas build:configure` links the project and writes an Expo `projectId` into `app.json` / `app.config`. Keep the commit after that.

Confirm `mobile/eas.json` already points production/dev env at:

```json
"EXPO_PUBLIC_API_URL": "https://lyncr.app"
```

Optional local file for Metro:

```bash
cp .env.example .env
```

(`.env` should contain `EXPO_PUBLIC_API_URL=https://lyncr.app` for device testing against production.)

## Build the development client (iOS)

```bash
cd /Users/JR/Desktop/Lyncr/mobile
npm run eas:dev:ios
```

That runs: `eas build --profile development --platform ios`.

- First time: register your Apple team, bundle id `app.lyncr.mobile`, and your device UDID when prompted.
- Wait for the cloud build (often 15–30 minutes).
- On the build page, install on your iPhone (internal distribution link / QR).

## Run JS against the installed app

After the custom app is on the phone:

```bash
cd /Users/JR/Desktop/Lyncr/mobile
npx expo start --dev-client
```

Open the **Lyncr** app (not Expo Go). It should connect to the bundler. Log in → open the **Collect** tab.

## Profiles (from `eas.json`)

| Profile | Purpose |
|---------|---------|
| `development` | Dev client + internal install; Tap to Pay SDK included |
| `preview` | Internal preview build |
| `production` | App Store / TestFlight |

## Brand assets

`mobile/assets/` must include:

- `icon.png` (1024×1024)
- `splash-icon.png`
- `adaptive-icon.png`

These are generated from the teal Lyncr **L** mark for store and splash.

## Next steps

1. Request Apple Tap to Pay entitlement — see [`TAP-TO-PAY-IPHONE.md`](./TAP-TO-PAY-IPHONE.md).
2. When ready for TestFlight: `npm run eas:prod:ios` then `eas submit --platform ios --profile production`.
3. Full store checklist: [`DEPLOY-TO-APP-STORE.md`](./DEPLOY-TO-APP-STORE.md) and [`APP-STORE-READINESS.md`](./APP-STORE-READINESS.md).
