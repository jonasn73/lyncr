import { redirect } from "next/navigation"
import { ReceptionistDispatchView } from "@/components/receptionist-dispatch-view"
import { getReceptionistPortalContext } from "@/lib/receptionist-portal-auth"
import { getSessionUser } from "@/lib/server-session-user"

export const dynamic = "force-dynamic"

export default async function ReceptionistDispatchPage() {
  const user = await getSessionUser()
  if (!user) redirect("/login?next=/receptionist/dispatch")

  const ctx = await getReceptionistPortalContext(user.id)
  if (!ctx || !ctx.receptionist.capabilities.dispatching) redirect("/receptionist")

  return <ReceptionistDispatchView />
}
