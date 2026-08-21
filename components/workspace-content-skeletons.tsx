"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
  WorkspacePanel,
  WorkspaceTableWrap,
  WorkspaceTh,
  WORKSPACE_TABLE_ROW_CLASS,
} from "@/components/dashboard-workspace-ui"

const SKELETON_BLOCK = "rounded-xl bg-zinc-900 sigo-skeleton-breathe"

/** Wrapper for lists/cards after data is ready — no opacity fade (that looked like a dark overlay). */
export function WorkspaceBloom({ children, className }: { children: ReactNode; className?: string }) {
  // Passthrough only: sigo-bloom-in started at opacity 0 and dimmed painted rows.
  return <div className={className}>{children}</div>
}

function SkeletonBar({ className }: { className?: string }) {
  return <div className={cn(SKELETON_BLOCK, className)} aria-hidden />
}

/** Who rings next card — same shape as WhoRingsConsole, not three dark boxes. */
export function CallFlowStepsSkeleton() {
  return (
    <section
      className="rounded-2xl border border-border/60 bg-muted/15 px-4 py-3.5 sm:px-5 sm:py-4"
      aria-busy="true"
      aria-label="Loading who rings next"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="h-9 w-9 shrink-0 rounded-xl border border-primary/25 bg-primary/10" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="hidden h-3 w-48 md:block" />
        </div>
      </div>
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <SkeletonBar className="h-3 w-20" />
            <SkeletonBar className="h-4 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border/50 pt-3">
        <div className="h-10 min-w-[8rem] flex-1 rounded-xl border border-border/60 bg-background/50 sm:flex-none" />
        <div className="h-10 min-w-[8rem] flex-1 rounded-xl border border-border/60 bg-background/50 sm:flex-none" />
      </div>
    </section>
  )
}

/** CRM customer rows — matches list card height, not a spinner. */
export function CrmListRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="space-y-1.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5"
        >
          <SkeletonBar className="h-4 w-32 max-w-[70%]" />
          <SkeletonBar className="mt-1.5 h-3 w-24 max-w-[50%]" />
        </li>
      ))}
    </ul>
  )
}

/** Messages thread rows — matches conversation list, not a spinner. */
export function MessagesThreadListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="space-y-1" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="rounded-xl px-3 py-3">
          <SkeletonBar className="h-4 w-28 max-w-[60%]" />
          <SkeletonBar className="mt-1.5 h-3 w-40 max-w-[80%]" />
        </li>
      ))}
    </ul>
  )
}

export function CallFlowLinePickerSkeleton() {
  return (
    <div className={cn("mx-auto h-[5.25rem] w-full max-w-md", SKELETON_BLOCK)} aria-hidden />
  )
}

type TableSkeletonProps = {
  columns: { width: string; label: string }[]
  rows?: number
  panelClassName?: string
}

function TableSkeletonBody({ columns, rows = 6 }: TableSkeletonProps) {
  return (
    <WorkspaceTableWrap>
      <colgroup>
        {columns.map((col, i) => (
          <col key={i} className={col.width} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((col) => (
            <WorkspaceTh key={col.label}>{col.label}</WorkspaceTh>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, i) => (
          <tr key={i} className={WORKSPACE_TABLE_ROW_CLASS}>
            {columns.map((col) => (
              <td key={col.label} className="border-b border-zinc-800/50 px-4 py-3.5 align-middle">
                <SkeletonBar className="h-4 w-[70%] max-w-[10rem]" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </WorkspaceTableWrap>
  )
}

export function ActivityTableSkeleton() {
  return (
    // Match page bg-background — bg-card/90 looked like a darker overlay on tab click.
    // Same 8 columns + min-h as live ActivityCallsTable so skeleton→rows does not collapse.
    <WorkspacePanel className="min-h-[380px] bg-background shadow-none ring-0">
      <TableSkeletonBody
        columns={[
          { width: "w-[11%]", label: "Status" },
          { width: "w-[12%]", label: "Called" },
          { width: "w-[18%]", label: "Caller" },
          { width: "w-[16%]", label: "Intake" },
          { width: "w-[8%]", label: "Duration" },
          { width: "w-[12%]", label: "Agent" },
          { width: "w-[13%]", label: "Line" },
          { width: "w-[10%]", label: " " },
        ]}
        rows={6}
      />
    </WorkspacePanel>
  )
}

export function PayStatCardsSkeleton() {
  return (
    <div className="grid min-h-[5.75rem] gap-4 sm:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className={cn("min-h-[5.75rem] rounded-2xl border border-zinc-800/60", SKELETON_BLOCK)} />
      ))}
    </div>
  )
}

export function PayLedgerSkeleton() {
  return (
    <WorkspacePanel className="min-h-[300px]">
      <div className="border-b border-zinc-800 px-5 py-4">
        <SkeletonBar className="h-4 w-32" />
      </div>
      <TableSkeletonBody
        columns={[
          { width: "w-[40%]", label: "Date" },
          { width: "w-[35%]", label: "Amount" },
          { width: "w-[25%]", label: " " },
        ]}
        rows={4}
      />
    </WorkspacePanel>
  )
}
