import { SchedulerWorkspaceView } from "@/components/workspace-views/scheduler-workspace-view"
import { requireReceptionistCapability } from "@/lib/receptionist-route-guard"

export const dynamic = "force-dynamic"

/** The owner's Scheduler, rendered in the receptionist console. Same component. */
export default async function ReceptionistSchedulerPage() {
  await requireReceptionistCapability("scheduler", "/receptionist/scheduler")
  return <SchedulerWorkspaceView />
}
