import { PayWorkspaceView } from "@/components/workspace-views/pay-workspace-view"

export const dynamic = "force-dynamic"

/** Statically import Pay so a hard refresh SSR’s wallet chrome, not PayPaneFallback. */
export default function PayRoute() {
  // Cookie billing paint seeds still drive the first numbers inside this view.
  return <PayWorkspaceView />
}
