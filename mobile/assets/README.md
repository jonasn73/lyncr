# App icon and splash assets

Add these image files so the app builds and looks correct on device and in the stores.

## Required files

| File | Purpose | Recommended size |
|------|---------|------------------|
| `icon.png` | App icon (iOS and Android) | **1024×1024 px** (Expo/App Store) |
| `splash-icon.png` | Splash screen image | e.g. **1284×2778 px** or see [Expo splash](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/) |
| `adaptive-icon.png` | Android adaptive icon (foreground) | **1024×1024 px** (foreground layer; background color is set in app.json) |

## Notes

- Use PNG with no transparency for `icon.png` (App Store).
- Splash background color is set in `app.json` (`splash.backgroundColor`: `#12101f`).
- Repo includes teal Lyncr **L** assets (`icon.png`, `splash-icon.png`, `adaptive-icon.png`). Regenerate from `app/icon.svg` if the mark changes.
- If these files are missing, the build may fail or use defaults. Add them before submitting to the App Store or Google Play.

## Expo docs

- [App icon and splash](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/)
- [Adaptive icon (Android)](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/#adaptive-icon)
