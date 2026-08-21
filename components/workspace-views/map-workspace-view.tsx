"use client"

// Map bottom-nav tab — single unified Dispatch Map (layers + Job Pool / Live Roster).

import { memo } from "react"
import { MapTab } from "@/components/dashboard/MapTab"
import { MapPaneFallback } from "@/components/workspace-pane-fallbacks"
import { WorkspacePaneHandoff } from "@/components/workspace-pane-handoff"

export const MapWorkspaceView = memo(function MapWorkspaceView({
  // Presence host keeps Map mounted after first visit — pause polls while hidden.
  isActive = true,
}: {
  isActive?: boolean
}) {
  // holdGate false + seeded handoff start: no skeleton flash over MapTab.
  // First visit from another tab still uses Suspense MapPaneFallback once (matched chrome).
  return (
    <WorkspacePaneHandoff holdGate={false} fallback={<MapPaneFallback />} probe="map-handoff">
      <MapTab isActive={isActive} />
    </WorkspacePaneHandoff>
  )
})
