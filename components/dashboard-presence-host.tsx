"use client"

import dynamic from "next/dynamic"
import {
  Suspense,
  cloneElement,
  isValidElement,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"
import { clearMainScrollLock } from "@/lib/mobile-scroll-lock"
import type { PageId } from "@/components/app-shell"
import { DashboardPage } from "@/components/dashboard-page"
import {
  ActivityPaneFallback,
  CrmPaneFallback,
  MapPaneFallback,
  MessagesPaneFallback,
  PayPaneFallback,
  SchedulerPaneFallback,
  SettingsPaneFallback,
} from "@/components/workspace-pane-fallbacks"
import { WorkspacePaneHandoff } from "@/components/workspace-pane-handoff"
import { prefetchOperationsData } from "@/lib/hooks/use-operations-data"
import {
  initialPresencePaneMounted,
  shouldMountPresencePane,
  shouldUseSsrActiveSlot,
} from "@/lib/dashboard-presence-ssr"
import {
  FlickerSuspenseFallback,
  useFlickerDebugLifecycle,
} from "@/lib/debug/flicker-debug"

// Inactive tabs only — code-split + skip SSR so Lines/Activity first paint stays small.
// The *active* hard-refresh URL is statically imported in that route's page.tsx.
// Chunk handoff: keep matching fallback covering until the real pane commits layout.
const ActivityWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/activity-workspace-view").then((m) => ({
      default: function ActivityChunkHandoff(props: { isActive?: boolean }) {
        return (
          <WorkspacePaneHandoff fallback={<ActivityPaneFallback />} probe="activity-chunk-handoff">
            <m.ActivityWorkspaceView {...props} />
          </WorkspacePaneHandoff>
        )
      },
    })),
  { ssr: false, loading: () => <ActivityPaneFallback /> }
)

const MessagesWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/messages-workspace-view").then((m) => ({
      default: function MessagesChunkHandoff(props: { isActive?: boolean }) {
        return (
          <WorkspacePaneHandoff fallback={<MessagesPaneFallback />} probe="messages-chunk-handoff">
            <m.MessagesWorkspaceView {...props} />
          </WorkspacePaneHandoff>
        )
      },
    })),
  { ssr: false, loading: () => <MessagesPaneFallback /> }
)

const SchedulerWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/scheduler-workspace-view").then((m) => ({
      default: function SchedulerChunkHandoff(props: { isActive?: boolean }) {
        return (
          <WorkspacePaneHandoff fallback={<SchedulerPaneFallback />} probe="scheduler-chunk-handoff">
            <m.SchedulerWorkspaceView {...props} />
          </WorkspacePaneHandoff>
        )
      },
    })),
  { ssr: false, loading: () => <SchedulerPaneFallback /> }
)

const CrmWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/crm-workspace-view").then((m) => ({
      default: function CrmChunkHandoff(props: { isActive?: boolean }) {
        return (
          <WorkspacePaneHandoff fallback={<CrmPaneFallback />} probe="crm-chunk-handoff">
            <m.CrmWorkspaceView {...props} />
          </WorkspacePaneHandoff>
        )
      },
    })),
  { ssr: false, loading: () => <CrmPaneFallback /> }
)

const MapWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/map-workspace-view").then((m) => ({
      default: function MapChunkHandoff(props: { isActive?: boolean }) {
        return (
          <WorkspacePaneHandoff fallback={<MapPaneFallback />} probe="map-chunk-handoff">
            <m.MapWorkspaceView {...props} />
          </WorkspacePaneHandoff>
        )
      },
    })),
  { ssr: false, loading: () => <MapPaneFallback /> }
)

const PayWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/pay-workspace-view").then((m) => ({
      default: function PayChunkHandoff(props: { isActive?: boolean }) {
        return (
          <WorkspacePaneHandoff fallback={<PayPaneFallback />} probe="pay-chunk-handoff">
            <m.PayWorkspaceView {...props} />
          </WorkspacePaneHandoff>
        )
      },
    })),
  { ssr: false, loading: () => <PayPaneFallback /> }
)

const SettingsWorkspaceViewLazy = dynamic(
  () =>
    import("@/components/workspace-views/settings-workspace-view").then((m) => ({
      default: function SettingsChunkHandoff(props: { isActive?: boolean }) {
        return (
          <WorkspacePaneHandoff fallback={<SettingsPaneFallback />} probe="settings-chunk-handoff">
            <m.SettingsWorkspaceView {...props} />
          </WorkspacePaneHandoff>
        )
      },
    })),
  { ssr: false, loading: () => <SettingsPaneFallback /> }
)

/** Primary command-dock segments kept mounted for instant tab swaps (no route branch flash). */
export const DASHBOARD_PRESENCE_PAGE_IDS = [
  "dashboard",
  "activity",
  "messages",
  "scheduler",
  "customers",
  "contacts",
  "pay",
  "settings",
] as const

export type DashboardPresencePageId = (typeof DASHBOARD_PRESENCE_PAGE_IDS)[number]

export function isDashboardPresencePage(page: PageId): page is DashboardPresencePageId {
  return (DASHBOARD_PRESENCE_PAGE_IDS as readonly string[]).includes(page)
}

const PresencePane = memo(function PresencePane({
  active,
  label,
  children,
  deferUntilVisit = false,
}: {
  active: boolean
  label: string
  children: ReactNode
  /** Skip mounting heavy panes until the user opens the tab once. */
  deferUntilVisit?: boolean
}) {
  // Active tab starts mounted so hard refresh SSR HTML is not `null` then a flash.
  const [visited, setVisited] = useState(() => initialPresencePaneMounted(deferUntilVisit, active))
  // First click: `active` is true while `visited` is still false — mount this frame (no blank).
  const shouldMount = shouldMountPresencePane(deferUntilVisit, visited, active)
  if (shouldMount && !visited) {
    // Adjusting state during render from props (React-approved pattern).
    setVisited(true)
  }

  useFlickerDebugLifecycle(`PresencePane:${label}`, {
    active,
    visited,
    shouldMount,
    deferUntilVisit,
    emptyUnmounted: !shouldMount,
  })

  useLayoutEffect(() => {
    if (active) setVisited(true)
  }, [active])

  if (!shouldMount) return null

  return (
    <section role="tabpanel" aria-label={label} aria-hidden={!active} hidden={!active} className="w-full">
      {children}
    </section>
  )
})

function RoutingPane() {
  return <DashboardPage />
}

/** Pass live `isActive` into the statically imported page slot without remounting it. */
function renderSsrActivePane(slot: ReactNode, isActive: boolean): ReactNode {
  // page.tsx returns a single workspace view element — clone so polls pause off-tab.
  if (isValidElement(slot)) {
    return cloneElement(slot as ReactElement<{ isActive?: boolean }>, { isActive })
  }
  return slot
}

/** All primary dashboard views stay mounted; inactive panes use `hidden` so they never paint. */
export const DashboardPresenceHost = memo(function DashboardPresenceHost({
  activePage,
  ssrActiveSlot = null,
}: {
  activePage: DashboardPresencePageId
  /** Statically imported view from the matching dashboard route page (hard-refresh SSR). */
  ssrActiveSlot?: ReactNode
}) {
  // Freeze which URL was SSR’d — client tab clicks must not swap this slot into another pane.
  const [ssrPage] = useState(activePage)
  // Freeze the page element descriptor so navigation does not replace Activity with CRM children.
  const ssrSlotRef = useRef(ssrActiveSlot)

  useFlickerDebugLifecycle("DashboardPresenceHost", {
    activePage,
    ssrPage,
  })

  useEffect(() => {
    if (activePage === "scheduler") return
    clearMainScrollLock()
  }, [activePage])

  useEffect(() => {
    // Warm Activity call rows while the owner is still on Lines (or any tab).
    prefetchOperationsData()
    // Warm Map + Activity chunks ASAP so the first tab click is not a dynamic() blank.
    void import("@/components/workspace-views/map-workspace-view")
    void import("@/components/workspace-views/activity-workspace-view")
    void import("@/components/workspace-views/crm-workspace-view")
    // Preload remaining heavy panes on idle.
    const warmChunks = () => {
      void import("@/components/workspace-views/crm-workspace-view")
      void import("@/components/workspace-views/messages-workspace-view")
      void import("@/components/workspace-views/map-workspace-view")
      void import("@/components/workspace-views/activity-workspace-view")
    }
    const idleId =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warmChunks, { timeout: 1800 })
        : window.setTimeout(warmChunks, 1200)
    return () => {
      if (typeof window.cancelIdleCallback === "function" && typeof idleId === "number") {
        window.cancelIdleCallback(idleId)
      } else {
        window.clearTimeout(idleId)
      }
    }
  }, [])

  return (
    <div className="w-full min-h-0 md:min-h-[calc(100dvh-4rem)]">
      {/* Lines is statically imported here — intake lives in shell (LyncEngine), not this pane. */}
      <PresencePane active={activePage === "dashboard"} label="Routing">
        <RoutingPane />
      </PresencePane>
      <PresencePane active={activePage === "activity"} label="Activities" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "activity") ? (
          // Hard refresh of /dashboard/activity — real ActivityWorkspaceView from page.tsx (SSR).
          <WorkspacePaneHandoff fallback={<ActivityPaneFallback />} probe="activity-ssr-handoff">
            {renderSsrActivePane(ssrSlotRef.current, activePage === "activity")}
          </WorkspacePaneHandoff>
        ) : (
          // Visited later — keep Activities chrome while the chunk loads.
          <Suspense
            fallback={
              <FlickerSuspenseFallback name="activity">
                <ActivityPaneFallback />
              </FlickerSuspenseFallback>
            }
          >
            <ActivityWorkspaceViewLazy isActive={activePage === "activity"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "messages"} label="Messages" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "messages") ? (
          <WorkspacePaneHandoff fallback={<MessagesPaneFallback />} probe="messages-ssr-handoff">
            {renderSsrActivePane(ssrSlotRef.current, activePage === "messages")}
          </WorkspacePaneHandoff>
        ) : (
          <Suspense
            fallback={
              <FlickerSuspenseFallback name="messages">
                <MessagesPaneFallback />
              </FlickerSuspenseFallback>
            }
          >
            <MessagesWorkspaceViewLazy isActive={activePage === "messages"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "scheduler"} label="Scheduler" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "scheduler") ? (
          <WorkspacePaneHandoff fallback={<SchedulerPaneFallback />} probe="scheduler-ssr-handoff">
            {renderSsrActivePane(ssrSlotRef.current, activePage === "scheduler")}
          </WorkspacePaneHandoff>
        ) : (
          <Suspense
            fallback={
              <FlickerSuspenseFallback name="scheduler">
                <SchedulerPaneFallback />
              </FlickerSuspenseFallback>
            }
          >
            <SchedulerWorkspaceViewLazy isActive={activePage === "scheduler"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "customers"} label="CRM" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "customers") ? (
          <WorkspacePaneHandoff fallback={<CrmPaneFallback />} probe="crm-ssr-handoff">
            {renderSsrActivePane(ssrSlotRef.current, activePage === "customers")}
          </WorkspacePaneHandoff>
        ) : (
          <Suspense
            fallback={
              <FlickerSuspenseFallback name="customers">
                <CrmPaneFallback />
              </FlickerSuspenseFallback>
            }
          >
            <CrmWorkspaceViewLazy isActive={activePage === "customers"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "contacts"} label="Map" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "contacts") ? (
          <WorkspacePaneHandoff fallback={<MapPaneFallback />} probe="map-ssr-handoff">
            {renderSsrActivePane(ssrSlotRef.current, activePage === "contacts")}
          </WorkspacePaneHandoff>
        ) : (
          // Keep Dispatch Map chrome while the chunk loads — never a blank frame.
          <Suspense
            fallback={
              <FlickerSuspenseFallback name="contacts">
                <MapPaneFallback />
              </FlickerSuspenseFallback>
            }
          >
            <MapWorkspaceViewLazy isActive={activePage === "contacts"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "pay"} label="Pay" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "pay") ? (
          <WorkspacePaneHandoff fallback={<PayPaneFallback />} probe="pay-ssr-handoff">
            {renderSsrActivePane(ssrSlotRef.current, activePage === "pay")}
          </WorkspacePaneHandoff>
        ) : (
          <Suspense
            fallback={
              <FlickerSuspenseFallback name="pay">
                <PayPaneFallback />
              </FlickerSuspenseFallback>
            }
          >
            <PayWorkspaceViewLazy isActive={activePage === "pay"} />
          </Suspense>
        )}
      </PresencePane>
      <PresencePane active={activePage === "settings"} label="Settings" deferUntilVisit>
        {shouldUseSsrActiveSlot(ssrPage, "settings") ? (
          <WorkspacePaneHandoff fallback={<SettingsPaneFallback />} probe="settings-ssr-handoff">
            {renderSsrActivePane(ssrSlotRef.current, activePage === "settings")}
          </WorkspacePaneHandoff>
        ) : (
          <Suspense
            fallback={
              <FlickerSuspenseFallback name="settings">
                <SettingsPaneFallback />
              </FlickerSuspenseFallback>
            }
          >
            <SettingsWorkspaceViewLazy isActive={activePage === "settings"} />
          </Suspense>
        )}
      </PresencePane>
    </div>
  )
})
