# Mobile app design and styles

Short assessment of lyncr’s mobile UI and what was improved for App Store–style quality.

---

## What’s already good

- **Consistent theme** – Dark background (`#0f172a`), card surfaces (`#1e293b`), primary (`#6366f1`), clear text/muted hierarchy. Feels like one app.
- **Readable typography** – Labels 12pt, body 14–16pt, headings 18–24pt. No tiny body text.
- **Spacing and layout** – Padding 16–24, card radius 12–16, maxWidth 400 on auth so it doesn’t over-stretch on tablets.
- **Keyboard handling** – Login and signup use `KeyboardAvoidingView` + `ScrollView` with `keyboardShouldPersistTaps="handled"` so the keyboard doesn’t cover inputs.
- **Loading and errors** – Spinners and error text on main screens; empty states (“No calls yet”, etc.).
- **Tab bar** – Themed; icons and labels are clear.

---

## Changes made for mobile standards

### 1. Safe area (notch / home indicator)

- **Before:** Fixed `paddingTop: 48` on auth/onboarding. Could overlap the notch or Dynamic Island on newer iPhones.
- **After:** Root layout wrapped in `SafeAreaProvider`. Login, signup, and onboarding use `useSafeAreaInsets()` and set `paddingTop: Math.max(48, insets.top + 16)` and `paddingBottom: insets.bottom + 24` (or 48) so content stays inside the safe area.

### 2. Touch targets (44pt minimum)

- **Before:** Some buttons and links had no minimum height; tap areas could be smaller than Apple’s 44pt recommendation.
- **After:** Primary buttons and “Try again” use `minHeight: 44` and `justifyContent: "center"`. Auth screen “Don’t have an account?” / “Already have an account?” links use `minHeight: 44` and `justifyContent: "center"`. Onboarding toggle and primary button, and Settings “Sign Out” and tappable cards, use at least 44pt height where they’re the main tap target.

### 3. Onboarding keyboard

- **Before:** Step 3 (AI greeting) had a `TextInput` but no `KeyboardAvoidingView`, so the keyboard could cover it on small screens.
- **After:** Onboarding is wrapped in `KeyboardAvoidingView` with `behavior="padding"` on iOS so the input stays visible when the keyboard is open.

### 4. Design tokens (optional reuse)

- **`mobile/lib/theme.ts`** – Central `colors`, `spacing`, `radius`, `fontSize`, and `touchTarget: 44`. You can import these in new screens to keep styles consistent. Existing screens still use inline values; you can refactor to the theme over time.

---

## Optional next steps

- **Use theme in StyleSheets** – Replace hardcoded hex and numbers with `theme.colors`, `theme.spacing`, etc., for easier tweaks and dark/light later.
- **Accessibility** – Add `accessibilityLabel` (and where useful `accessibilityRole` / `accessibilityHint`) to buttons, inputs, and tab items (see `docs/APP-STORE-READINESS.md`).
- **Tab content safe area** – If you add content that scrolls under the tab bar, add bottom padding using `insets.bottom` so the last items aren’t hidden by the home indicator.

---

## Summary

Design and styles were already in good shape: consistent, readable, and keyboard-aware on auth. The updates above bring the app in line with common mobile guidelines: **safe areas** so content clears notch and home indicator, **44pt minimum touch targets** for main actions and links, and **keyboard avoiding** on onboarding. Using `theme.ts` going forward will keep the app consistent and easier to maintain.
