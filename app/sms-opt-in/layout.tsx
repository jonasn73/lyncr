import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/brand"

export const metadata: Metadata = {
  title: "SMS opt-in",
  description: `Affirmative SMS consent for ${SITE_NAME} service notifications and appointment alerts.`,
}

export default function SmsOptInLayout({ children }: { children: React.ReactNode }) {
  return children
}
