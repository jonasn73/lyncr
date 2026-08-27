"use client"

// Receptionist training portal — certification grid, study modules, and quizzes.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Award,
  BookOpen,
  CheckCircle2,
  Loader2,
  Lock,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { toggleFieldStatus } from "@/app/actions/training-engine"
import type { PublicTrainingCertificationCard } from "@/lib/training-engine"
import { formatRoutingPoolSkillLabel, routingSkillTagFromCertCode } from "@/lib/routing-pool-skills"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"

type Props = {
  userId: string
  initialCatalog: PublicTrainingCertificationCard[]
}

function fieldLabel(code: string, name: string): string {
  const tag = routingSkillTagFromCertCode(code)
  return formatRoutingPoolSkillLabel(tag) || name
}

function CertificationCard({
  card,
  toggling,
  onToggleActive,
}: {
  card: PublicTrainingCertificationCard
  toggling: boolean
  onToggleActive: (next: boolean) => void
}) {
  const { certification, certified, badge } = card
  const fieldActive = badge?.active_toggle !== false
  const href = `/receptionist/training/${encodeURIComponent(certification.code_identifier)}`

  const cardInner = (
    <>
      {certified ? (
        <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber-400/10 blur-2xl" />
      ) : null}
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {certified ? <CheckCircle2 className="h-5 w-5 text-amber-300" aria-hidden /> : <Lock className="h-5 w-5" aria-hidden />}
          </div>
          {certified ? (
            <Badge className="border-0 bg-amber-500/20 text-amber-100">
              <Sparkles className="mr-1 h-3 w-3" aria-hidden />
              Certified
            </Badge>
          ) : (
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              Locked
            </Badge>
          )}
        </div>
        <div>
          <CardTitle className="text-lg">{certification.name}</CardTitle>
          <CardDescription className="mt-1 line-clamp-2">
            {certification.module_data.description || fieldLabel(certification.code_identifier, certification.name)}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
          {certification.module_data.lessons.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1">
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              {certification.module_data.lessons.length} lessons
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1">
            <Award className="h-3.5 w-3.5" aria-hidden />
            {certification.module_data.quiz.length} questions
          </span>
        </div>

        {certified ? (
          <div
            className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-3"
            onClick={(e) => e.preventDefault()}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">Live routing</p>
              <p className="text-sm text-zinc-400">
                {fieldActive ? "Receiving matched calls" : "Field paused — hidden from queue"}
              </p>
            </div>
            <Switch
              checked={fieldActive}
              disabled={toggling}
              onCheckedChange={onToggleActive}
              aria-label={`Toggle ${certification.name} routing`}
            />
          </div>
        ) : (
          <p className="text-sm text-primary">Open course & quiz →</p>
        )}
      </CardContent>
    </>
  )

  if (certified) {
    return (
      <Card
        className={cn(
          "relative overflow-hidden border transition-all duration-200",
          "cursor-default border-amber-400/40 bg-gradient-to-br from-amber-950/40 via-card to-violet-950/30 shadow-[0_0_40px_-12px_rgba(251,191,36,0.35)]"
        )}
      >
        {cardInner}
      </Card>
    )
  }

  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <Card
        className={cn(
          "relative overflow-hidden border transition-all duration-200",
          "cursor-pointer border-border/70 bg-card/80 hover:border-primary/40 hover:shadow-md"
        )}
      >
        {cardInner}
      </Card>
    </Link>
  )
}

export function ReceptionistTrainingView({ userId, initialCatalog }: Props) {
  const [catalog, setCatalog] = useState(initialCatalog)
  const [togglingCode, setTogglingCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(!initialCatalog.length)

  const refreshCatalog = useCallback(() => {
    setLoading(true)
    fetch("/api/receptionist/training", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not refresh certifications")
        const json = (await res.json()) as { data?: { catalog?: PublicTrainingCertificationCard[] } }
        setCatalog(json.data?.catalog ?? [])
      })
      .catch(() => toast.error("Could not refresh certifications"))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!initialCatalog.length) refreshCatalog()
  }, [initialCatalog.length, refreshCatalog])

  const certifiedCount = catalog.filter((c) => c.certified).length

  async function handleToggleActive(code: string, next: boolean) {
    setTogglingCode(code)
    const result = await toggleFieldStatus(userId, code, next)
    setTogglingCode(null)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(next ? "Field activated — you can receive matched calls." : "Field paused.")
    refreshCatalog()
  }

  return (
    <WorkspacePage>
      <WorkspacePageHeader title="Certifications & training" />
      <p className="-mt-4 max-w-2xl text-sm text-zinc-400">
        Earn specialty badges to join live routing pools. Toggle fields on or off anytime.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
          {certifiedCount} certified
        </Badge>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
          {catalog.length - certifiedCount} available to unlock
        </Badge>
      </div>

      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center text-zinc-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
          Loading courses…
        </div>
      ) : catalog.length === 0 ? (
        <WorkspacePanel density="roomy" className="text-center text-sm text-zinc-500">
          No certifications are published yet. Ask your operator to run migration 043 in Neon.
        </WorkspacePanel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.map((card) => (
            <CertificationCard
              key={card.certification.id}
              card={card}
              toggling={togglingCode === card.certification.code_identifier}
              onToggleActive={(next) => void handleToggleActive(card.certification.code_identifier, next)}
            />
          ))}
        </div>
      )}
    </WorkspacePage>
  )
}
