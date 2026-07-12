"use client"

// Tech assignment picker with geographic best-match badge.

import { useEffect, useMemo, useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  jobGeoContextFromJob,
  pickBestMatchTechUserId,
} from "@/lib/tech-territory-match"
import { SCHEDULER_INPUT, SCHEDULER_METADATA_LABEL } from "@/lib/scheduler-ui-tokens"
import type { ActivePipelineJob, FieldTechnician, TechLiveLocation, UnassignedPoolJob } from "@/lib/types"

type TechAssignmentSelectProps = {
  technicians: FieldTechnician[]
  value: string
  disabled?: boolean
  job: UnassignedPoolJob | ActivePipelineJob
  activePipelineJobs?: ActivePipelineJob[]
  onChange: (techUserId: string) => void
}

export function TechAssignmentSelect({
  technicians,
  value,
  disabled,
  job,
  activePipelineJobs = [],
  onChange,
}: TechAssignmentSelectProps) {
  const [techLocations, setTechLocations] = useState<TechLiveLocation[]>([])

  useEffect(() => {
    let cancelled = false
    void fetch("/api/owner/jobs", { credentials: "include" })
      .then((res) => res.json())
      .then((json: { data?: { techLocations?: TechLiveLocation[] } }) => {
        if (cancelled) return
        setTechLocations(Array.isArray(json.data?.techLocations) ? json.data!.techLocations! : [])
      })
      .catch(() => {
        if (!cancelled) setTechLocations([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const assignableTechs = useMemo(
    () => technicians.filter((tech) => tech.is_active && tech.portal_user_id),
    [technicians]
  )

  const bestMatchTechId = useMemo(() => {
    return pickBestMatchTechUserId({
      technicians: assignableTechs,
      jobGeo: jobGeoContextFromJob(job),
      assignedJobs: activePipelineJobs,
      techLiveLocations: techLocations,
    })
  }, [assignableTechs, job, activePipelineJobs, techLocations])

  const selectedTech = assignableTechs.find((t) => t.portal_user_id === value)

  return (
    <div className="space-y-1.5">
      <Select
        value={value || "__unassigned__"}
        disabled={disabled}
        onValueChange={(next) => onChange(next === "__unassigned__" ? "" : next)}
      >
        <SelectTrigger className={cn(SCHEDULER_INPUT, "h-10 w-full")}>
          <SelectValue placeholder="Unassigned — select when scheduled">
            {selectedTech ? selectedTech.name : "Unassigned — select when scheduled"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="border-slate-800/80 bg-slate-900/95 backdrop-blur-md">
          <SelectItem value="__unassigned__">Unassigned — select when scheduled</SelectItem>
          {assignableTechs.map((tech) => {
            const techUserId = tech.portal_user_id!
            const isBestMatch = bestMatchTechId === techUserId
            return (
              <SelectItem key={techUserId} value={techUserId} className="py-2.5">
                <span className="flex w-full items-center justify-between gap-2">
                  <span>{tech.name}</span>
                  {isBestMatch ? (
                    <span className="shrink-0 text-[11px] font-semibold tracking-wider text-emerald-400">
                      ★ Closest
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      {bestMatchTechId ? (
        <p className={SCHEDULER_METADATA_LABEL}>
          Territory match uses ZIP, city, active assignments, and live GPS.
        </p>
      ) : null}
    </div>
  )
}
