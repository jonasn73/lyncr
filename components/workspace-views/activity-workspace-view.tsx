"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { businessNumbersMatch } from "@/lib/dashboard-routing-utils"
import {
  DrawerStepHeader,
  DrawerScrollBody,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  WorkspaceTableWrap,
  WorkspaceTh,
  WorkspaceTd,
  ActivityStatusPill,
  WORKSPACE_TABLE_ROW_CLASS,
  type ActivityCallStatus,
} from "@/components/dashboard-workspace-ui"
import {
  ActivityTableSkeleton,
  WorkspaceBloom,
} from "@/components/workspace-content-skeletons"
import {
  WorkspaceRightSheetGate,
  useWorkspaceRightSheet,
} from "@/components/workspace-right-sheet-gate"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useOperationsData, type UiCallRecord } from "@/lib/hooks/use-operations-data"
import {
  buildBusinessLineLabelMap,
  resolveBusinessLineLabel,
  type LineLabelEntry,
} from "@/lib/line-display"

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, "0")}s`
}

function classifyCall(call: UiCallRecord): ActivityCallStatus {
  const routed = call.routedTo ?? ""
  if (call.type === "missed") return "missed"
  if (call.type === "voicemail" || /ai|assistant|voice/i.test(routed)) return "ai_handled"
  if (call.durationSeconds > 0) return "answered"
  return "missed"
}

function simulatedTranscript(call: UiCallRecord): { role: "ai" | "caller"; text: string }[] {
  return [
    { role: "ai", text: "Thank you for calling. How can I help you today?" },
    { role: "caller", text: `Hi, this is ${call.callerName}. I need assistance.` },
    { role: "ai", text: "I can help. What's the best callback number?" },
    { role: "caller", text: `${call.callerNumber}` },
    { role: "ai", text: "Captured. Someone will follow up shortly." },
  ]
}

function CallLogSheet({ call, onClose }: { call: UiCallRecord; onClose: () => void }) {
  const lines = simulatedTranscript(call)
  return (
    <>
      <DrawerStepHeader
        step="Log"
        title="Call transcript"
        subtitle={`${call.callerName} · ${call.callerNumber}`}
      />
      <DrawerScrollBody>
        <div className="space-y-3">
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[92%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                line.role === "ai"
                  ? "mr-auto border border-cyan-500/30 bg-cyan-500/10 text-foreground"
                  : "ml-auto border border-zinc-700 bg-zinc-900/80 text-zinc-300"
              )}
            >
              {line.text}
            </div>
          ))}
        </div>
      </DrawerScrollBody>
      <DrawerStickyFooter dirty={false} saving={false} onSave={onClose} onCancel={onClose} saveLabel="Close" />
    </>
  )
}

type ActivityTableProps = {
  rows: UiCallRecord[]
  lineLabelMap: Map<string, string>
}

const ActivityCallsTable = memo(function ActivityCallsTable({ rows, lineLabelMap }: ActivityTableProps) {
  const openLog = useWorkspaceRightSheet<UiCallRecord>()
  const { setSelectedActivityLog } = useDashboardWorkspace()

  return (
    <WorkspacePanel className="min-h-[380px]">
      <WorkspaceTableWrap className="min-h-[340px]">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[30%]" />
          <col className="w-[14%]" />
          <col className="w-[24%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead>
          <tr>
            <WorkspaceTh>Status</WorkspaceTh>
            <WorkspaceTh>Caller</WorkspaceTh>
            <WorkspaceTh>Duration</WorkspaceTh>
            <WorkspaceTh>Target line</WorkspaceTh>
            <WorkspaceTh />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <WorkspaceTd colSpan={5} className="py-12 text-center text-zinc-600">
                No calls yet
              </WorkspaceTd>
            </tr>
          ) : (
            rows.map((call) => {
              const st = classifyCall(call)
              const targetLabel = resolveBusinessLineLabel(call.targetLineE164, lineLabelMap)
              return (
                <tr key={call.id} className={cn("transition-colors hover:bg-zinc-900/50", WORKSPACE_TABLE_ROW_CLASS)}>
                  <WorkspaceTd>
                    <ActivityStatusPill status={st} />
                  </WorkspaceTd>
                  <WorkspaceTd>
                    <p className="font-medium">{call.callerName}</p>
                    <p className="text-xs text-zinc-500">{call.callerNumber}</p>
                  </WorkspaceTd>
                  <WorkspaceTd className="tabular-nums text-zinc-400">
                    {formatDuration(call.durationSeconds)}
                  </WorkspaceTd>
                  <WorkspaceTd>
                    <p className="truncate font-medium text-zinc-200" title={targetLabel}>
                      {targetLabel}
                    </p>
                  </WorkspaceTd>
                  <WorkspaceTd className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedActivityLog(call)
                        openLog(call)
                      }}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-400"
                    >
                      View log
                    </button>
                  </WorkspaceTd>
                </tr>
              )
            })
          )}
        </tbody>
      </WorkspaceTableWrap>
    </WorkspacePanel>
  )
})

type ActivityBodyProps = {
  loading: boolean
  loadError: string | null
  refreshing: boolean
  lineLabelMap: Map<string, string>
}

const ActivityWorkspaceBody = memo(function ActivityWorkspaceBody({
  loading,
  loadError,
  refreshing,
  lineLabelMap,
}: ActivityBodyProps) {
  const { activityLogs, activeLine } = useDashboardWorkspace()

  const rows = useMemo(() => {
    let list = activityLogs
    if (activeLine) {
      list = list.filter((c) => businessNumbersMatch(c.targetLineE164, activeLine))
    }
    return [...list].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
  }, [activityLogs, activeLine])

  return (
    <WorkspacePage>
      <WorkspacePageHeader
        eyebrow="Live"
        title="Activity"
        action={
          activeLine ? (
            <p className="text-xs text-zinc-500">
              Filtered to active line ·{" "}
              <span className="font-medium text-zinc-300">{resolveBusinessLineLabel(activeLine, lineLabelMap)}</span>
            </p>
          ) : null
        }
      />

      {refreshing ? <p className="text-xs text-zinc-600">Refreshing…</p> : null}

      {loading && activityLogs.length === 0 ? (
        <ActivityTableSkeleton />
      ) : loadError && activityLogs.length === 0 ? (
        <p className="min-h-[380px] text-sm text-destructive">{loadError}</p>
      ) : (
        <WorkspaceBloom>
          <ActivityCallsTable rows={rows} lineLabelMap={lineLabelMap} />
        </WorkspaceBloom>
      )}
    </WorkspacePage>
  )
})

function useLineLabelMap(): Map<string, string> {
  const { businessNumbers } = useDashboardWorkspace()
  const [fetched, setFetched] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    if (businessNumbers.length > 0) {
      const entries: LineLabelEntry[] = businessNumbers.map((n) => ({
        number: n.number,
        label: "Business Line",
      }))
      setFetched(buildBusinessLineLabelMap(entries))
      return
    }
    let cancelled = false
    fetch("/api/numbers/mine", { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : { numbers: [] }))
      .then((data) => {
        if (cancelled) return
        const numbers = Array.isArray(data.numbers) ? data.numbers : []
        const entries: LineLabelEntry[] = numbers.map((n: { number?: string; label?: string }) => ({
          number: String(n.number ?? ""),
          label: String(n.label ?? "Business Line"),
        }))
        setFetched(buildBusinessLineLabelMap(entries))
      })
      .catch(() => {
        if (!cancelled) setFetched(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [businessNumbers])

  return fetched
}

export const ActivityWorkspaceView = memo(function ActivityWorkspaceView() {
  const { calls, loading, loadError, refreshing } = useOperationsData()
  const { setActivityLogs, closeActivityLog } = useDashboardWorkspace()
  const lineLabelMap = useLineLabelMap()

  useEffect(() => {
    setActivityLogs(calls)
  }, [calls, setActivityLogs])

  return (
    <WorkspaceRightSheetGate<UiCallRecord>
      render={(call, close) => (
        <CallLogSheet
          call={call}
          onClose={() => {
            close()
            closeActivityLog()
          }}
        />
      )}
    >
      <ActivityWorkspaceBody
        loading={loading}
        loadError={loadError}
        refreshing={refreshing}
        lineLabelMap={lineLabelMap}
      />
    </WorkspaceRightSheetGate>
  )
})
