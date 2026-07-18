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
import { calculateTechETA, sortTechsByProximityEta } from "@/lib/dispatch-eta"
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

  const jobPin = useMemo(() => {
    if (job.latitude == null || job.longitude == null) return null
    if (!Number.isFinite(job.latitude) || !Number.isFinite(job.longitude)) return null
    return { lat: job.latitude, lng: job.longitude }
  }, [job.latitude, job.longitude])

  const techsByProximity = useMemo(() => {
    return sortTechsByProximityEta(assignableTechs, jobPin, (tech) => {
      const loc = techLocations.find((t) => t.tech_user_id === tech.portal_user_id)
      if (!loc) return null
      return { lat: loc.latitude, lng: loc.longitude }
    })
  }, [assignableTechs, jobPin, techLocations])

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
        <SelectTrigger
          className={cn(
            SCHEDULER_INPUT,
            "h-10 w-full",
            disabled && "opacity-55"
          )}
        >
          <SelectValue placeholder={disabled ? "Set status to Scheduled first" : "Select a tech"}>
            {selectedTech
              ? selectedTech.name
              : disabled
                ? "Set status to Scheduled first"
                : "Select a tech"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="border-slate-800/80 bg-slate-900/95 backdrop-blur-md">
          <SelectItem value="__unassigned__">Unassigned</SelectItem>
          {techsByProximity.map((tech) => {
            const techUserId = tech.portal_user_id!
            const isBestMatch = bestMatchTechId === techUserId
            const loc = techLocations.find((t) => t.tech_user_id === techUserId)
            const eta = calculateTechETA(
              jobPin,
              loc ? { lat: loc.latitude, lng: loc.longitude } : null
            )
            return (
              <SelectItem key={techUserId} value={techUserId} className="py-2.5">
                <span className="flex w-full items-center justify-between gap-2">
                  <span>{tech.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {eta ? (
                      <span className="text-[10px] font-medium tabular-nums text-slate-400">
                        {eta.label}
                      </span>
                    ) : null}
                    {isBestMatch ? (
                      <span className="text-[11px] font-semibold tracking-wider text-emerald-400">
                        ★ Closest
                      </span>
                    ) : null}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      {bestMatchTechId ? (
        <p className={SCHEDULER_METADATA_LABEL}>
          Sorted by proximity ETA when live GPS is available (ZIP / territory fallback otherwise).
        </p>
      ) : null}
    </div>
  )
}
