# lyncr Mobile (Expo)

React Native mobile app for lyncr. It uses the **same Next.js backend** as the web app: all API routes stay in the parent project; the app just calls them over the network.

## How it works

- **Backend**: The Next.js app in the parent folder (`/`) runs the API (`/api/auth/*`, `/api/routing`, `/api/calls`, etc.). Run it with `npm run dev` from the project root.
- **Mobile**: This Expo app is a separate front-end. It talks to the backend via `API_URL` (see below). Auth uses **cookies**: the API sets a session cookie and the app sends it with every request (`credentials: 'include'`).

## Quick start

1. **Start the Next.js backend** (from repo root):
   ```bash
   cd ..
   npm run dev
   ```
   Leave it running (e.g. at http://localhost:3000).

2. **Set the API URL** for the mobile app:
   - Create `mobile/.env` with:
     ```
     EXPO_PUBLIC_API_URL=http://localhost:3000
     ```
   - **On a physical device**: use your computer’s IP (e.g. `http://192.168.1.10:3000`) or a tunnel (ngrok, etc.), not `localhost`.
   - **iOS Simulator**: `http://localhost:3000` usually works.
   - **Android Emulator**: use `http://10.0.2.2:3000` instead of localhost.

3. **Install and run the mobile app**:
   ```bash
   cd mobile
   npm install
   npx expo start
   ```
   Then press `i` for iOS simulator or `a` for Android emulator, or scan the QR code with Expo Go on your phone.

## Project structure

- `app/` – Expo Router screens:
  - `index.tsx` – checks session, redirects to login or tabs
  - `login.tsx`, `signup.tsx`, `onboarding.tsx` – auth flow
  - `(tabs)/` – main app: Routing (dashboard), Activity, Contacts, Pay, Settings
- `lib/api.ts` – `API_URL`, `apiGet()`, `apiMutate()` (all use `credentials: 'include'`)
- `lib/useSession.ts` – `useSession()` hook that calls `/api/auth/session`

## Deploying for production

1. Deploy the Next.js app (e.g. Vercel) and note its URL.
2. In `mobile/.env`, set:
   ```
   EXPO_PUBLIC_API_URL=https://your-app.vercel.app
   ```
3. Build the app: `eas build` (Expo Application Services) or `expo build` for classic builds.

The same API and cookie-based auth work for both web and mobile; only the UI is different.
