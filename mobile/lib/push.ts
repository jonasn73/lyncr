/**
 * Native push notifications for missed/live calls — registers this device's Expo push
 * token with the backend (see app/api/push/register/route.ts on the Next.js side).
 * Expo's own push service handles APNs/FCM delivery; we only ever deal in Expo push tokens.
 */

import * as Device from "expo-device"
import Constants from "expo-constants"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"
import { apiMutate } from "./api"

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

/**
 * Request permission (if needed) and register this device's Expo push token with the
 * backend. Safe to call on every app launch — silently does nothing on a simulator/emulator
 * (Expo push tokens require a physical device) or if permission is denied.
 */
export async function registerForPushNotificationsAsync(): Promise<void> {
  if (!Device.isDevice) return

  const existing = await Notifications.getPermissionsAsync()
  let status = existing.status
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync()
    status = requested.status
  }
  if (status !== "granted") return

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) {
    // eas build:configure hasn't been run yet — nothing to register against.
    return
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    const platform = Platform.OS === "android" ? "android" : "ios"
    await apiMutate("/api/push/register", { method: "POST", body: { token, platform } })
  } catch (e) {
    // Never let push registration break app startup or login.
    console.warn("[push] registration failed:", e)
  }
}
