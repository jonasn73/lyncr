// Public page when the customer cancels Stripe Checkout pay link.

import { CustomerPortalShell } from "@/components/customer-portal-shell"

export default function PayCancelledPage() {
  return (
    <CustomerPortalShell
      businessName="Payment cancelled"
      mode="pay"
      currentStep="pay"
      subtitle="No charge was made. Ask the business to send a new link if you still need to pay."
      centered
    >
      <p className="text-center text-xs text-zinc-500">You can close this window.</p>
    </CustomerPortalShell>
  )
}
