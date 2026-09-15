/**
 * Registers this device for push notifications once the user is inside the authenticated
 * tab stack (mirrors TerminalBootstrap's "run once on mount" shape), and deep-links a tapped
 * missed-call notification into the Activity tab.
 */

import { useEffect, type ReactNode } from "react"
import { useRouter } from "expo-router"
import * as Notifications from "expo-notifications"
import { registerForPushNotificationsAsync } from "@/lib/push"

export function PushNotificationsBootstrap({ children }: { children: ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    void registerForPushNotificationsAsync()

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string } | undefined
      if (data?.type === "call-missed" || data?.type === "call-initiated") {
        router.push("/(tabs)/activity")
      }
    })
    return () => subscription.remove()
  }, [router])

  return <>{children}</>
}
