import { MapWorkspaceView } from "@/components/workspace-views/map-workspace-view"

export const dynamic = "force-dynamic"

/** Statically import Map chrome so reload paints Dispatch Map header + height; Leaflet fills in after. */
export default function ContactsRoute() {
  // Leaflet stays ssr:false inside MapTab — only this shell is in the first HTML.
  return <MapWorkspaceView />
}
