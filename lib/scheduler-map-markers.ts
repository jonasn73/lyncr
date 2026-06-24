// Shared copy + styling for scheduler map marker tooltips and icons.

import { vehicleLabelFromParts } from "@/lib/job-pool"
import {
  SCHEDULER_MAP_PIN_COLOR,
  SCHEDULER_STATUS_LABEL,
  type SchedulerLifecyclePhase,
  schedulerLifecyclePhase,
} from "@/lib/scheduler-job-status"
import type { SchedulerEvent, UnassignedPoolJob } from "@/lib/types"

export type MapMarkerTooltipModel = {
  id: string
  kind: "pool" | "scheduled"
  phase: SchedulerLifecyclePhase
  customerName: string | null
  customerPhone: string | null
  vehicleLine: string | null
  keyTypeLine: string | null
  jobType: string | null
  statusLabel: string
  pinColor: string
  routeOrder?: number
}

export function formatMapPhone(num: string | null): string {
  if (!num) return "—"
  const d = num.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return num
}

/** Pull a human key-type line from intake notes / job type. */
export function keyTypeLine(jobType: string | null, jobNotes: string | null): string | null {
  const notes = (jobNotes ?? "").toLowerCase()
  const parts: string[] = []
  if (/smart|prox/.test(notes)) parts.push("Smart / Prox")
  if (/laser/.test(notes)) parts.push("Laser cut")
  if (/akl|all keys lost/.test(notes)) parts.push("AKL")
  if (parts.length) return parts.join(" · ")
  if (jobType?.trim()) return jobType.trim()
  return null
}

export function tooltipFromPoolJob(
  job: UnassignedPoolJob,
  poolIndex: number,
  extras?: { job_status?: string | null; assigned_tech_id?: string | null }
): MapMarkerTooltipModel {
  const phase = schedulerLifecyclePhase({
    dispatch_status: job.dispatch_status,
    assigned_tech_id: extras?.assigned_tech_id ?? null,
    job_status: extras?.job_status ?? null,
  })
  return {
    id: job.id,
    kind: "pool",
    phase,
    customerName: job.customer_name,
    customerPhone: job.customer_phone,
    vehicleLine: vehicleLabelFromParts(job.vehicle_year, job.vehicle_make, job.vehicle_model),
    keyTypeLine: keyTypeLine(job.job_type, job.job_notes),
    jobType: job.job_type,
    statusLabel: SCHEDULER_STATUS_LABEL[phase],
    pinColor: SCHEDULER_MAP_PIN_COLOR[phase],
    routeOrder: poolIndex,
  }
}

export function tooltipFromScheduledEvent(
  event: SchedulerEvent,
  routeOrder: number
): MapMarkerTooltipModel {
  const phase = schedulerLifecyclePhase({
    job_status: event.job_status,
    dispatch_status: event.dispatch_status,
    assigned_tech_id: event.assigned_tech_id,
  })
  return {
    id: event.id,
    kind: "scheduled",
    phase,
    customerName: event.customer_name,
    customerPhone: event.customer_phone,
    vehicleLine: vehicleLabelFromParts(event.vehicle_year, event.vehicle_make, event.vehicle_model),
    keyTypeLine: keyTypeLine(event.job_type, event.job_notes),
    jobType: event.job_type,
    statusLabel: SCHEDULER_STATUS_LABEL[phase],
    pinColor: SCHEDULER_MAP_PIN_COLOR[phase],
    routeOrder,
  }
}

/** Escape text before injecting into marker/tooltip HTML strings. */
function escapeMarkerHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Status-aware circular job pin (Leaflet divIcon HTML). */
export function jobStatusPinHtml(phase: SchedulerLifecyclePhase, label: string): string {
  if (phase === "completed") {
    return `<span class="lyncr-job-pin lyncr-job-pin--completed" aria-hidden="true">✓</span>`
  }
  const phaseClass: Record<Exclude<SchedulerLifecyclePhase, "completed">, string> = {
    unassigned: "lyncr-job-pin--unassigned",
    scheduled: "lyncr-job-pin--scheduled",
    en_route: "lyncr-job-pin--en-route",
    on_site: "lyncr-job-pin--on-site",
  }
  return `<span class="lyncr-job-pin ${phaseClass[phase]}" aria-hidden="true">${escapeMarkerHtml(label)}</span>`
}

/** Minimal dark hover tooltip — customer, phone, vehicle, service type only. */
export function mapMarkerTooltipHtml(model: MapMarkerTooltipModel): string {
  const name = escapeMarkerHtml(model.customerName?.trim() || "Customer")
  const phone = escapeMarkerHtml(formatMapPhone(model.customerPhone))
  const vehicle = escapeMarkerHtml(model.vehicleLine?.trim() || "—")
  const service = escapeMarkerHtml(model.jobType?.trim() || "—")
  return (
    `<div class="lyncr-map-hover-tooltip__name">${name}</div>` +
    `<div class="lyncr-map-hover-tooltip__line">${phone}</div>` +
    `<div class="lyncr-map-hover-tooltip__line">${vehicle}</div>` +
    `<div class="lyncr-map-hover-tooltip__line">${service}</div>`
  )
}

/** @deprecated Use jobStatusPinHtml — kept for any legacy imports. */
export function scheduledPinHtml(order: number, _color: string, phase: SchedulerLifecyclePhase): string {
  return jobStatusPinHtml(phase, phase === "completed" ? "✓" : String(order))
}

/** @deprecated Use jobStatusPinHtml — kept for any legacy imports. */
export function poolPinHtml(label: string, _color = "#f97316"): string {
  return jobStatusPinHtml("unassigned", label)
}

export const MAP_MARKER_ANIMATION_CSS = `
  .lyncr-job-pin {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 9999px;
    background: #09090b;
    border: 2px solid transparent;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    box-sizing: border-box;
  }
  .lyncr-job-pin--unassigned {
    border-color: #f59e0b;
    color: #f59e0b;
  }
  .lyncr-job-pin--scheduled {
    border-color: #14b8a6;
    color: #5eead4;
  }
  .lyncr-job-pin--en-route {
    border-color: #22d3ee;
    color: #22d3ee;
    animation: lyncrPinPulse 1.5s ease-in-out infinite;
  }
  .lyncr-job-pin--on-site {
    border-color: #10b981;
    color: #34d399;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  }
  .lyncr-job-pin--completed {
    width: 28px;
    height: 28px;
    border-color: #22c55e;
    color: #86efac;
    font-size: 13px;
    opacity: 0.85;
  }
  @keyframes lyncrPinPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }
  @keyframes techEnRouteRing {
    0% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.75), 0 0 12px rgba(45, 212, 191, 0.35); }
    70% { box-shadow: 0 0 0 12px rgba(45, 212, 191, 0), 0 0 16px rgba(45, 212, 191, 0.45); }
    100% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0), 0 0 12px rgba(45, 212, 191, 0.35); }
  }
  @keyframes techOnSiteRing {
    0%, 100% { box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.95), 0 0 14px rgba(250, 204, 21, 0.55); }
    50% { box-shadow: 0 0 0 4px rgba(234, 179, 8, 1), 0 0 20px rgba(250, 204, 21, 0.75); }
  }
  .tech-marker-en-route { animation: techEnRouteRing 1.8s ease-out infinite; }
  .tech-marker-on-site { animation: techOnSiteRing 2.2s ease-in-out infinite; }
`

/** Micro-badge pin for a live technician — initials + status ring. */
export function techBadgePinHtml(initials: string, status: string | null): string {
  const isEnRoute = status === "en_route"
  const isOnSite = status === "on_site" || status === "arrived"
  const ringClass = isEnRoute
    ? "tech-marker-en-route"
    : isOnSite
      ? "tech-marker-on-site"
      : ""
  const fill = isEnRoute ? "#0f766e" : isOnSite ? "#ca8a04" : "#52525b"
  const textColor = isOnSite ? "#fef9c3" : "#ecfdf5"
  const border = isOnSite ? "2px solid #facc15" : "2px solid #18181b"
  const idleShadow = !isEnRoute && !isOnSite ? "box-shadow:0 0 0 2px rgba(161,161,170,0.35);" : ""
  return `<span class="${ringClass}" style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:${fill};border:${border};font-size:10px;font-weight:800;color:${textColor};letter-spacing:-0.02em;${idleShadow}">${initials}</span>`
}
