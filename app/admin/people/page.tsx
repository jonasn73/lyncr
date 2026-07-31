import { OperatorOnboardingDashboard } from "@/components/admin/operator-onboarding-dashboard"
import { AdminInviteReceptionistDialog } from "@/components/admin-invite-receptionist-dialog"

export const dynamic = "force-dynamic"

export default function AdminPeoplePage() {
  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-5xl space-y-2 px-4 pt-4 sm:px-6">
        <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-400">
          <span className="font-medium text-slate-200">Login invite (this page):</span> SMS/email so someone gets a
          receptionist account and portal.{" "}
          <span className="font-medium text-slate-200">Call contact:</span> business owners still add name + phone on
          their Team screen and pick who answers on Routing — that person does not need a Lyncr login.
        </p>
        <div className="flex justify-end">
          <AdminInviteReceptionistDialog />
        </div>
      </div>
      <div className="px-4 pb-8 sm:px-6">
        <OperatorOnboardingDashboard />
      </div>
    </div>
  )
}
