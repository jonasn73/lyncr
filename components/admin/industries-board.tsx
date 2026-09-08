"use client"

// Admin "Industries" — one row per signup-able industry, showing whether the AI script,
// manual job types, equipment-on-file, and receptionist live-call layout are covered, plus
// how many live accounts picked it. Expand a row to see the actual config (living docs).

import { useState } from "react"
import { RefreshCw, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useAdminIndustriesOverview } from "@/hooks/use-admin-industries-overview"
import type { AdminIndustryOverviewRow } from "@/lib/admin-industries-overview"

function CoverageBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? "secondary" : "outline"} className={cn(!ok && "text-muted-foreground")}>
      {label}
    </Badge>
  )
}

function IndustryRow({ row }: { row: AdminIndustryOverviewRow }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell className="w-6">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-medium text-foreground">{row.label}</TableCell>
        <TableCell className="text-right tabular-nums">{row.liveAccountCount}</TableCell>
        <TableCell>
          <CoverageBadge
            ok={row.aiScript.source === "bespoke" || row.aiScript.branchTitles.length > 0}
            label={row.aiScript.source === "bespoke" ? "Bespoke script" : `Registry (${row.aiScript.branchTitles.length})`}
          />
        </TableCell>
        <TableCell>
          <CoverageBadge
            ok={row.jobTypes.source !== "generic_fallback"}
            label={
              row.jobTypes.source === "locksmith"
                ? "Locksmith"
                : row.jobTypes.source === "bespoke"
                  ? "Bespoke"
                  : row.jobTypes.source === "registry"
                    ? `Registry (${row.jobTypes.options.length})`
                    : "Generic fallback"
            }
          />
        </TableCell>
        <TableCell>
          {row.equipment ? (
            <CoverageBadge ok label={row.equipment.label} />
          ) : (
            <span className="text-2xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>
          <span className="text-2xs text-muted-foreground capitalize">
            {row.receptionistLayout.replace(/_/g, " ")}
          </span>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell />
          <TableCell colSpan={6} className="py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  AI script branches
                </p>
                {row.aiScript.branchTitles.length > 0 ? (
                  <ul className="mt-1 list-inside list-disc text-sm text-foreground">
                    {row.aiScript.branchTitles.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Bespoke greeting — see lib/ai-intake-defaults.ts.
                  </p>
                )}
              </div>
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Manual job types
                </p>
                <ul className="mt-1 list-inside list-disc text-sm text-foreground">
                  {row.jobTypes.options.map((o) => (
                    <li key={o.id}>{o.label}</li>
                  ))}
                </ul>
                {row.vehicleAware ? (
                  <p className="mt-1 text-2xs text-muted-foreground">Account-level vehicle info shown.</p>
                ) : null}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

export function IndustriesBoard() {
  const { industries, loading, refreshing, refetch } = useAdminIndustriesOverview()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Industries</h1>
          <p className="text-sm text-muted-foreground">
            Every signup-able industry, live account counts, and how each one is actually wired
            up today — AI phone script, manual job types, equipment-on-file, and receptionist
            live-call layout.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refetch()}>
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Industry</TableHead>
              <TableHead className="text-right">Live accounts</TableHead>
              <TableHead>AI script</TableHead>
              <TableHead>Job types</TableHead>
              <TableHead>Equipment on file</TableHead>
              <TableHead>Receptionist layout</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  Loading industries…
                </TableCell>
              </TableRow>
            ) : industries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No industries found.
                </TableCell>
              </TableRow>
            ) : (
              industries.map((row) => <IndustryRow key={row.id} row={row} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
