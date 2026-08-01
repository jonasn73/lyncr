import { PlatformNotificationSettings } from "@/components/admin/platform-notification-settings"
import { cardFeeFormulaLabel } from "@/lib/admin-platform-finance"

export const dynamic = "force-dynamic"

export default function AdminSettingsPage() {
  const feeLabel = cardFeeFormulaLabel()
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-50">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Platform-owner notification channels — receptionists and field techs never see this panel.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-sm font-semibold text-slate-100">Card payment fee (Lyncr take)</h2>
        <p className="mt-1 text-sm text-slate-400">
          When a business runs Collect / Tap to Pay, Lyncr keeps{" "}
          <span className="font-medium text-violet-200">{feeLabel}</span>. Change with env vars{" "}
          <code className="text-violet-200">LYNCR_PAYMENT_FEE_BPS</code> and{" "}
          <code className="text-violet-200">LYNCR_PAYMENT_FEE_FLAT_CENTS</code> in Vercel (then redeploy).
        </p>
      </div>

      <PlatformNotificationSettings variant="admin" />
    </div>
  )
}
