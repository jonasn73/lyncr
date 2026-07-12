"use client"

// Internal UI audit gallery — renders core presentation primitives with mock data.

import { useMemo, useState } from "react"
import {
  DrawerScrollBody,
  DrawerStepHeader,
  DrawerStickyFooter,
} from "@/components/dashboard-routing-drawer-shared"
import { ActivePipelinePanel } from "@/components/scheduler/active-pipeline-panel"
import { JobDetailOverview } from "@/components/scheduler/job-detail-overview"
import { JobPoolCard } from "@/components/scheduler/job-pool-card"
import {
  KeySelectionCard,
  type KeySelectionCardModel,
} from "@/components/vehicle-key-info-panel"
import { KEY_STYLE_OPTIONS } from "@/lib/vehicle-key-styles"
import type { JobPipelineStatusId } from "@/lib/job-pipeline-status"
import { WS_METADATA, WS_OPTION_ROW, WS_OPTION_ROW_ACTIVE, WS_TEXT } from "@/lib/workspace-ui-tokens"
import { cn } from "@/lib/utils"
import type { ActivePipelineJob, FieldTechnician, UnassignedPoolJob } from "@/lib/types"

/** Shared mock fields so every demo card looks like a real Louisville lockout. */
function basePoolJob(partial: Partial<UnassignedPoolJob> & { id: string }): UnassignedPoolJob {
  return {
    id: partial.id,
    customer_name: partial.customer_name ?? "Allen Brooks",
    customer_phone: partial.customer_phone ?? "+15025550123",
    location: partial.location ?? "412 E Market St, Louisville, KY",
    neighborhood: partial.neighborhood ?? "NuLu",
    summary: partial.summary ?? "Customer locked out of 2019 Honda Civic",
    job_type: partial.job_type ?? "Lockout",
    vehicle_year: partial.vehicle_year ?? "2019",
    vehicle_make: partial.vehicle_make ?? "Honda",
    vehicle_model: partial.vehicle_model ?? "Civic",
    programming_method: partial.programming_method ?? "OBD2",
    job_notes: partial.job_notes ?? "Gate code 4411 — park on street",
    scheduled_at: partial.scheduled_at ?? null,
    duration_minutes: partial.duration_minutes ?? 60,
    dispatch_status: partial.dispatch_status ?? "unassigned_pool",
    created_at: partial.created_at ?? new Date().toISOString(),
    region: partial.region ?? "KY",
    postal_code: partial.postal_code ?? "40202",
    latitude: partial.latitude ?? 38.2527,
    longitude: partial.longitude ?? -85.7585,
    quoted_price_cents: partial.quoted_price_cents ?? 18500,
  }
}

function basePipelineJob(
  partial: Partial<ActivePipelineJob> & { id: string }
): ActivePipelineJob {
  return {
    ...basePoolJob(partial),
    job_status: partial.job_status ?? "assigned",
    assigned_tech_id: partial.assigned_tech_id ?? "tech-demo-1",
    assigned_tech_name: partial.assigned_tech_name ?? "Jordan Lee",
    dispatch_status: partial.dispatch_status ?? "DISPATCHED",
  }
}

const MOCK_TECHS: FieldTechnician[] = [
  {
    id: "ft-1",
    owner_user_id: "owner-demo",
    organization_id: null,
    portal_user_id: "tech-demo-1",
    name: "Jordan Lee",
    phone: "+15025550999",
    email: "jordan@example.com",
    is_active: true,
    created_at: new Date().toISOString(),
  },
]

/** Key-grid cards that mirror the automotive intake selection matrix. */
const KEY_MATRIX: KeySelectionCardModel[] = KEY_STYLE_OPTIONS.map((label, index) => ({
  id: `key-style-${index}`,
  label,
  description: index === 0 ? "Most common for late-model Civics" : null,
  imageUrl: null,
  programmingMethod: index % 2 === 0 ? "OBD2 add key" : "On-board sequence",
}))

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  )
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return <p className={cn(WS_METADATA, "mb-2")}>{children}</p>
}

/** Client gallery body — all interactive mocks live here. */
export function UiComponentGallery() {
  const now = useMemo(() => new Date(), [])
  const [selectedKeyId, setSelectedKeyId] = useState(KEY_MATRIX[0]?.id ?? "")
  const [drawerNotes, setDrawerNotes] = useState("Verify blade before cutting blank.")
  const [pipelineStatus, setPipelineStatus] = useState<JobPipelineStatusId>("DISPATCHED")
  const [assignedTechId, setAssignedTechId] = useState("tech-demo-1")

  // Offset times from "now" so priority / urgency chips stay stable during the session.
  const minutesFromNow = (mins: number) => new Date(now.getTime() + mins * 60_000).toISOString()

  const hopperCards: Array<{ label: string; job: UnassignedPoolJob }> = [
    {
      label: "Normal (LOW)",
      job: basePoolJob({
        id: "pool-normal",
        customer_name: "Sam Normal",
        created_at: minutesFromNow(-240),
        scheduled_at: minutesFromNow(180),
      }),
    },
    {
      label: "Urgent (CRITICAL ASAP)",
      job: basePoolJob({
        id: "pool-urgent",
        customer_name: "Urgency Case",
        created_at: minutesFromNow(-8),
        scheduled_at: null,
      }),
    },
  ]

  const pipelineJobs: ActivePipelineJob[] = [
    basePipelineJob({
      id: "pipe-normal",
      customer_name: "Normal Assigned",
      scheduled_at: minutesFromNow(90),
      job_status: "assigned",
    }),
    basePipelineJob({
      id: "pipe-urgent",
      customer_name: "Urgent Imminent",
      scheduled_at: minutesFromNow(12),
      job_status: "assigned",
    }),
    basePipelineJob({
      id: "pipe-overdue",
      customer_name: "Overdue Stop",
      scheduled_at: minutesFromNow(-45),
      job_status: "en_route",
    }),
    basePipelineJob({
      id: "pipe-completed",
      customer_name: "Completed Job",
      scheduled_at: minutesFromNow(-120),
      job_status: "completed",
    }),
  ]

  const overviewSource = basePoolJob({
    id: "drawer-job",
    customer_name: "Drawer Typography",
    scheduled_at: minutesFromNow(40),
    dispatch_status: "DISPATCHED",
  })

  return (
    <div className="flex flex-col gap-8 bg-slate-950 p-4">
      <header className="border-b border-slate-850 pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Internal</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-100">UI component gallery</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Visual audit bed for job cards, selection grids, and drawer typography. Resize the viewport to
          verify mobile layout density without clicking through live workflows.
        </p>
      </header>

      <Section
        title="1 · Hopper job cards"
        description="JobPoolCard priority shells — Normal vs Urgent ASAP."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {hopperCards.map(({ label, job }) => (
            <div key={job.id}>
              <StateLabel>{label}</StateLabel>
              <JobPoolCard job={job} variant="sidebar" onSelect={() => undefined} />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="2 · Active job cards"
        description="ActivePipelinePanel mobile sheet layout — Normal, Urgent, Overdue, Completed."
      >
        <div className="rounded-xl border border-slate-850 bg-slate-900/30 p-3">
          <ActivePipelinePanel
            jobs={pipelineJobs}
            layout="mobileSheet"
            includeAllPhases
            onFocusJob={() => undefined}
            onEditJob={() => undefined}
            onMarkComplete={() => undefined}
          />
        </div>
      </Section>

      <Section
        title="3 · Key selection matrix"
        description="Exported KeySelectionCard grid used by automotive intake."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KEY_MATRIX.map((card) => (
            <KeySelectionCard
              key={card.id}
              card={card}
              selected={selectedKeyId === card.id}
              onClick={() => setSelectedKeyId(card.id)}
            />
          ))}
        </div>
        <p className={cn(WS_METADATA, "mt-2 normal-case tracking-normal")}>
          Selected: {KEY_MATRIX.find((c) => c.id === selectedKeyId)?.label ?? "—"}
        </p>
      </Section>

      <Section
        title="4 · Workspace option rows"
        description="Token-level WS_OPTION_ROW / WS_OPTION_ROW_ACTIVE matrix (non-image selection)."
      >
        <div className="grid grid-cols-2 gap-2">
          {["Lockout", "Spare key", "Ignition", "Remote only"].map((label, index) => {
            const active = index === 1
            return (
              <button
                key={label}
                type="button"
                className={cn(active ? WS_OPTION_ROW_ACTIVE : WS_OPTION_ROW, "w-full")}
              >
                <span className={WS_TEXT}>{label}</span>
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        title="5 · Routing drawer chrome"
        description="DrawerStepHeader + scroll body + sticky footer — typography hierarchy stress test."
      >
        <div className="flex max-h-[28rem] flex-col overflow-hidden rounded-xl border border-slate-850 bg-zinc-950">
          <DrawerStepHeader
            step="Step 02"
            title="Who answers first?"
            subtitle="Pick the primary ring target for this line. Backup paths stay on the next step."
            lineLabel="Main · (502) 555-0100"
          />
          <DrawerScrollBody>
            <p className="text-sm leading-relaxed text-slate-400">
              Body copy uses the standard drawer padding and scroll container so long forms do not
              collide with the sticky footer. Metadata labels stay uppercase and quiet.
            </p>
            <div className="mt-4 grid gap-2">
              {["Owner cell", "Receptionist pool", "AI receptionist"].map((row, index) => (
                <button
                  key={row}
                  type="button"
                  className={cn(index === 0 ? WS_OPTION_ROW_ACTIVE : WS_OPTION_ROW, "w-full")}
                >
                  <span className={WS_TEXT}>{row}</span>
                </button>
              ))}
            </div>
          </DrawerScrollBody>
          <DrawerStickyFooter
            dirty
            saving={false}
            onSave={() => undefined}
            onCancel={() => undefined}
            saveLabel="Save routing"
          />
        </div>
      </Section>

      <Section
        title="6 · Job detail drawer panel"
        description="JobDetailOverview rendered inline (no Sheet) for typography + Quick Actions density."
      >
        <div className="max-h-[36rem] overflow-hidden rounded-xl border border-slate-850 bg-card">
          <JobDetailOverview
            source={overviewSource}
            scheduledEvent={null}
            poolJob={overviewSource}
            technicians={MOCK_TECHS}
            activePipelineJobs={pipelineJobs}
            quotedPriceDollars={185}
            baselineQuotedDollars={220}
            discountLabel="Rescue offer"
            jobNotes={drawerNotes}
            pipelineStatus={pipelineStatus}
            assignedTechId={assignedTechId}
            pipelineDirty={false}
            saving={false}
            onEdit={() => undefined}
            onPipelineStatusChange={setPipelineStatus}
            onAssignedTechChange={setAssignedTechId}
            onSavePipeline={() => undefined}
            onJobNotesChange={setDrawerNotes}
            onSaveJobNotes={() => undefined}
            onQuickLifecycleAction={() => undefined}
            onClose={() => undefined}
          />
        </div>
      </Section>
    </div>
  )
}
