import { ReceptionistDispatchView } from "@/components/receptionist-dispatch-view"
import { requireReceptionistCapability } from "@/lib/receptionist-route-guard"

export const dynamic = "force-dynamic"

export default async function ReceptionistDispatchPage() {
  await requireReceptionistCapability("dispatching", "/receptionist/dispatch")
  return <ReceptionistDispatchView />
}
