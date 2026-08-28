import { PlatformNotificationSettings } from "@/components/admin/platform-notification-settings"
import { cardFeeFormulaLabel } from "@/lib/admin-platform-finance"

export const dynamic = "force-dynamic"

export default function AdminSettingsPage() {
  const feeLabel = cardFeeFormulaLabel()
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-3 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alerts for you as the platform owner — not shown to businesses or receptionists.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notifications</h2>
        <PlatformNotificationSettings variant="admin" />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Card payment fee</h2>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm text-foreground">
            When a business collects a card payment, Lyncr keeps{" "}
            <span className="font-medium text-violet-200">{feeLabel}</span>.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            To change this, update fee settings in Vercel and redeploy. You do not need to edit this page.
          </p>
        </div>
      </section>
    </div>
  )
}
