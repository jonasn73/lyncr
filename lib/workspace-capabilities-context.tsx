"use client"

// What the person looking at a shared workspace view is allowed to do.
//
// The owner console and the receptionist console render the SAME views (CRM, scheduler,
// invoicing). This context is how one component tree knows which of the two it is inside
// without every view learning about roles: it carries the same ReceptionistCapabilities
// object lib/workspace-actor.ts enforces on the server, so the affordance a view hides is
// the affordance the API refuses.
//
// Hiding a button is never the protection — it is the courtesy. The gate is server-side.
//
// The default is an owner with everything granted, so a view mounted outside any provider
// (the whole owner console today) behaves exactly as it did before this existed.

import { createContext, useContext, type ReactNode } from "react"
import { ALL_CAPABILITIES_GRANTED } from "@/lib/receptionist-capabilities"
import type { ReceptionistCapabilities } from "@/lib/types"

export type WorkspaceViewer = {
  actorRole: "owner" | "receptionist"
  capabilities: ReceptionistCapabilities
}

const OWNER_VIEWER: WorkspaceViewer = {
  actorRole: "owner",
  capabilities: ALL_CAPABILITIES_GRANTED,
}

const WorkspaceCapabilitiesContext = createContext<WorkspaceViewer>(OWNER_VIEWER)

export function WorkspaceCapabilitiesProvider({
  viewer,
  children,
}: {
  viewer: WorkspaceViewer
  children: ReactNode
}) {
  return (
    <WorkspaceCapabilitiesContext.Provider value={viewer}>
      {children}
    </WorkspaceCapabilitiesContext.Provider>
  )
}

/** True when the viewer may do `capability`. Read it, don't infer from actorRole. */
export function useCan(capability: keyof ReceptionistCapabilities): boolean {
  return useContext(WorkspaceCapabilitiesContext).capabilities[capability] === true
}
