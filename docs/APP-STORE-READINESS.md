# App Store & Google Play Readiness

Checklist to get lyncr approved on the **Apple App Store** and **Google Play**. Use this before submitting.

---

## Must-have (blocking)

### 1. Privacy policy URL
- **Required by both stores.** You must provide a live, public URL in App Store Connect and Play Console.
- **In-app:** Set `NEXT_PUBLIC_PRIVACY_POLICY_URL` (web) and `EXPO_PUBLIC_PRIVACY_POLICY_URL` (mobile). The Settings screen shows a “Security & Privacy” / “Privacy Policy” link that opens this URL when set.
- **Content:** Describe what data you collect (email, name, phone, business name, call logs, recordings), how you use it, and how users can request deletion. Mention Telnyx/carrier providers and your hosting (e.g. Vercel, Neon).

### 2. App icon and splash (mobile)
- **Location:** `mobile/assets/` (see `mobile/assets/README.md` for sizes).
- **Required files:**
  - `icon.png` – 1024×1024 px (App Store), Expo will generate other sizes
  - `splash-icon.png` – e.g. 1284×2778 px or use Expo’s splash specs
  - `adaptive-icon.png` – 1024×1024 px (Android foreground)
- **Status:** Lyncr teal **L** assets are checked in under `mobile/assets/`.
- **If missing:** EAS/Expo builds can fail or use defaults. Add these before submitting.
- See: [Expo icons](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/), [adaptive icon](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/#adaptive-icon).

### 3. 401 → login (mobile)
- When the session expires or is invalid, API calls return **401**. The app **redirects to the login screen** instead of only showing “Failed to load.”
- **Implemented:** Tab screens (Routing, Activity, Contacts, Pay) check for `error.status === 401` and call `router.replace("/login")`.

### 4. Error boundary (mobile)
- An uncaught JavaScript error in any screen can crash the app. A **React Error Boundary** catches render errors and shows a “Something went wrong” screen with a “Try again” button.
- **Implemented:** `mobile/app/_layout.tsx` exports `ErrorBoundary` (Expo Router uses it to wrap the layout).

### 5. No dead ends
- **Forgot password:** Either implement a “Forgot password?” flow or remove the link so it’s not a dead end.
- **Support/Contact:** Set `NEXT_PUBLIC_SUPPORT_URL` (web) and `EXPO_PUBLIC_SUPPORT_URL` (mobile). Settings shows “Help & Support” that opens this URL when set. Both stores expect users to be able to contact you.

---

## Recommended (design & quality)

### 6. Safe area (mobile)
- Use `SafeAreaView` or `useSafeAreaInsets()` so content doesn’t sit under the notch or home indicator. Especially on login, signup, onboarding, and tab screens.

### 7. Accessibility (mobile)
- Add `accessibilityLabel` (and where useful `accessibilityRole` / `accessibilityHint`) for:
  - All buttons and links
  - Form inputs (email, password, phone, etc.)
  - Tab bar items
  - Main headings/sections
- Improves App Store review and usability for VoiceOver/TalkBack users.

### 8. Web error pages
- Add `app/error.tsx` and `app/not-found.tsx` so the web app shows a proper error/404 page instead of a blank or default error.

### 9. Touch targets (web + mobile)
- Buttons and tappable elements should be at least **44×44 pt** (Apple HIG). Check nav items, form buttons, and list rows.

### 10. Terms of use
- Optional but recommended: a Terms of Use URL (linked from signup or Settings). Some regions or use cases require it.

---

## Before you submit

- [ ] Privacy policy URL is live and linked in the app and in store listing.
- [ ] `mobile/assets/` contains `icon.png`, `splash-icon.png`, and `adaptive-icon.png` in required sizes.
- [ ] Mobile app redirects to login on 401 (session expired).
- [ ] Mobile app has an error boundary so a single screen error doesn’t crash the app.
- [ ] “Forgot password?” is either implemented or removed; Support/Contact link is present.
- [ ] App Store Connect: screenshots, description, keywords, age rating, contact and privacy URLs filled.
- [ ] Google Play Console: store listing, content rating questionnaire, privacy policy URL, contact details filled.
- [ ] Test on a real device (iOS and Android): login, signup, main tabs, logout, and session expiry.

---

## Reference

- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Program Policies](https://play.google.com/about/developer-content-policy/)
- [Expo submission (iOS)](https://docs.expo.dev/submit/ios/)
- [Expo submission (Android)](https://docs.expo.dev/submit/android/)
