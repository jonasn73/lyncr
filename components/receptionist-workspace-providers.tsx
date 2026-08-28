"use client"

// The context core a shared workspace view needs, mounted for the receptionist console.
//
// CRM, Scheduler and the invoicing panel are ONE component set rendered by both consoles.
// They reach for a handful of contexts that used to exist only inside DashboardShell —
// chiefly useDashboardWorkspace, which throws outside its provider. This mounts exactly
// those, and deliberately not the owner chrome around them:
//
//   not mounted    why
//   AppShell       owner navigation; the receptionist has her own chrome
//   LyncEngine     owner call engine — she has her own call desk, and double-handling a
//                  ringing line is the one thing this console must not do
//   Numbers /      buying lines, carrier credit, and settings are the owner's account,
//   Upgrade modals not the front desk's
//
// No shared view imports the hooks those provide (checked: the throwing hooks are used
// only by app-shell, command dock, routing surface, call-flow and CallAnsweredModal), so
// leaving them out is safe rather than merely cheaper.

import type { ReactNode } from "react"
import { DashboardPaintSeedsProvider } from "@/lib/dashboard-paint-seeds"
import { DashboardSessionProvider } from "@/components/dashboard-session-context"
import { DashboardWorkspaceProvider } from "@/components/dashboard-workspace-context"
import { DispatchCommandBridgeProvider } from "@/lib/dispatch-command-bridge"
import { ErrorBoundary } from "@/components/error-boundary"
import { InboundCallPanelProvider } from "@/lib/inbound-call-panel-context"
import { SessionCacheHydrationGate } from "@/components/session-cache-hydration-gate"
import { SwrProvider } from "@/components/swr-provider"
import { ViewportHintProvider } from "@/components/viewport-hint-provider"
import { WorkspaceCapabilitiesProvider, type WorkspaceViewer } from "@/lib/workspace-capabilities-context"
import { WorkspaceOrganizationsSeed } from "@/components/workspace-organizations-seed"
import type { ViewportMobileHint } from "@/lib/viewport-hint"
import type { Organization } from "@/lib/types"

export function ReceptionistWorkspaceProviders({
  viewer,
  receptionistName,
  receptionistEmail,
  ownerUserId,
  organizations,
  activeOrganizationId,
  initialIsMobile = null,
  children,
}: {
  viewer: WorkspaceViewer
  receptionistName: string
  receptionistEmail: string
  /** Account the shared views read and write — the business, not the receptionist. */
  ownerUserId: string
  organizations: Organization[]
  activeOrganizationId: string | null
  initialIsMobile?: ViewportMobileHint
  children: ReactNode
}) {
  return (
    <ErrorBoundary>
      <ViewportHintProvider initialIsMobile={initialIsMobile}>
        <DashboardPaintSeedsProvider seeds={null}>
          <SessionCacheHydrationGate>
            <DashboardSessionProvider
              session={{
                name: receptionistName,
                email: receptionistEmail,
                // Shared views scope their data by the business, so this is the owner's id.
                companyUserId: ownerUserId,
              }}
            >
              <SwrProvider>
                <DashboardWorkspaceProvider initialActiveOrganizationId={activeOrganizationId}>
                  <WorkspaceOrganizationsSeed
                    organizations={organizations}
                    activeOrganizationId={activeOrganizationId}
                  />
                  <InboundCallPanelProvider>
                    <DispatchCommandBridgeProvider>
                      <WorkspaceCapabilitiesProvider viewer={viewer}>
                        {children}
                      </WorkspaceCapabilitiesProvider>
                    </DispatchCommandBridgeProvider>
                  </InboundCallPanelProvider>
                </DashboardWorkspaceProvider>
              </SwrProvider>
            </DashboardSessionProvider>
          </SessionCacheHydrationGate>
        </DashboardPaintSeedsProvider>
      </ViewportHintProvider>
    </ErrorBoundary>
  )
}
