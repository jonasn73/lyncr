import { PlatformNotificationSettings } from "@/components/admin/platform-notification-settings"

export const dynamic = "force-dynamic"

export default function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-50">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Platform-owner notification channels — receptionists and field techs never see this panel.
        </p>
      </div>
      <PlatformNotificationSettings variant="admin" />
    </div>
  )
}
