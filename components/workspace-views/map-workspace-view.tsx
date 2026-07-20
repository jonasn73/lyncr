"use client"

// Map bottom-nav tab — single unified Dispatch Map (layers + Job Pool / Live Roster).

import { memo } from "react"
import { MapTab } from "@/components/dashboard/MapTab"

export const MapWorkspaceView = memo(function MapWorkspaceView() {
  return <MapTab />
})
