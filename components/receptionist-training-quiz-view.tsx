"use client"

// Dynamic certification quiz — progress tracker and graded submission.

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Award,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  PartyPopper,
  RotateCcw,
  Sparkles,
} from "lucide-react"
import { submitQuizAnswers } from "@/app/actions/training-engine"
import type { PublicCertificationDatasetEntry } from "@/lib/data/certifications"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from "@/components/dashboard-workspace-ui"

type Props = {
  userId: string
  certification: PublicCertificationDatasetEntry
  alreadyCertified: boolean
}

export function ReceptionistTrainingQuizView({ userId, certification, alreadyCertified }: Props) {
  const router = useRouter()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  const [resultModal, setResultModal] = useState<{
    passed: boolean
    message: string
    score: number
    total: number
    percent: number
  } | null>(null)

  const questions = certification.questions
  const answeredCount = useMemo(
    () => questions.filter((q) => Boolean(answers[q.id]?.trim())).length,
    [answers, questions]
  )
  const progressPercent = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0
  const allAnswered = answeredCount === questions.length && questions.length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await submitQuizAnswers(userId, certification.certification_code, answers)
      if (!result.ok) {
        setResultModal({
          passed: false,
          message: result.error,
          score: 0,
          total: 0,
          percent: 0,
        })
        return
      }
      setResultModal({
        passed: result.passed,
        message: result.message,
        score: result.score,
        total: result.total,
        percent: result.percent,
      })
    })
  }

  function closeResultModal() {
    const passed = resultModal?.passed ?? false
    setResultModal(null)
    if (passed) router.push("/receptionist/training")
    else router.refresh()
  }

  return (
    <WorkspacePage>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="text-zinc-400">
          <Link href="/receptionist/training">
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
            All certifications
          </Link>
        </Button>
        <Badge variant="outline" className="border-primary/30 text-primary">
          {certification.certification_code}
        </Badge>
        {alreadyCertified ? (
          <Badge className="border-0 bg-amber-500/20 text-amber-100">
            <Sparkles className="mr-1 h-3 w-3" aria-hidden />
            Certified
          </Badge>
        ) : null}
      </div>

      <WorkspacePageHeader title={certification.title} />

      <WorkspacePanel className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Award className="h-4 w-4 text-primary" aria-hidden />
            <span>
              Quiz progress:{" "}
              <span className="font-semibold text-foreground">
                {answeredCount}/{questions.length}
              </span>{" "}
              answered
            </span>
          </div>
          <span className="text-xs font-medium text-zinc-500">
            Passing score: {certification.passing_score}%
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-zinc-800"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Quiz completion progress"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-primary transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </WorkspacePanel>

      <form onSubmit={handleSubmit} className="space-y-6 pb-8">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Certification quiz
        </div>

        {questions.map((question, index) => (
          <fieldset key={question.id} className="space-y-4">
            <legend className="text-base font-semibold text-foreground">
              {index + 1}. {question.question}
            </legend>
            <RadioGroup
              value={answers[question.id] ?? ""}
              onValueChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
              className="grid gap-3 sm:grid-cols-1"
            >
              {question.options.map((option) => {
                const selected = answers[question.id] === option
                const optionId = `${question.id}-${option.replace(/\s+/g, "-").slice(0, 40)}`
                return (
                  <Label key={option} htmlFor={optionId} className="cursor-pointer">
                    <Card
                      className={cn(
                        "border transition-all hover:border-primary/40",
                        selected
                          ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                          : "border-border/70 bg-card/60"
                      )}
                    >
                      <CardContent className="flex items-start gap-3 p-4">
                        <RadioGroupItem value={option} id={optionId} className="mt-0.5" />
                        <span className="text-sm leading-relaxed text-foreground">{option}</span>
                      </CardContent>
                    </Card>
                  </Label>
                )
              })}
            </RadioGroup>
          </fieldset>
        ))}

        <Button type="submit" size="lg" disabled={pending || !allAnswered} className="min-w-[200px]">
          {pending ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
              Grading answers…
            </>
          ) : (
            "Submit answers"
          )}
        </Button>
      </form>

      <Dialog open={resultModal != null} onOpenChange={(open) => !open && closeResultModal()}>
        <DialogContent className="border-border bg-card sm:max-w-md">
          {resultModal?.passed ? (
            <>
              <DialogHeader className="items-center text-center">
                <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 ring-2 ring-emerald-400/40">
                  <PartyPopper className="h-8 w-8 text-emerald-300" aria-hidden />
                </div>
                <DialogTitle className="text-2xl text-emerald-100">You&apos;re certified!</DialogTitle>
                <DialogDescription className="text-base text-zinc-300">{resultModal.message}</DialogDescription>
              </DialogHeader>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center">
                <p className="text-3xl font-bold tabular-nums text-emerald-200">
                  {resultModal.score}/{resultModal.total}
                </p>
                <p className="mt-1 text-sm text-emerald-100/80">{resultModal.percent}% — routing pool unlocked</p>
              </div>
              <DialogFooter className="sm:justify-center">
                <Button type="button" onClick={closeResultModal} className="min-w-[160px]">
                  <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
                  Back to certifications
                </Button>
              </DialogFooter>
            </>
          ) : resultModal ? (
            <>
              <DialogHeader className="items-center text-center">
                <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 ring-2 ring-amber-400/40">
                  <RotateCcw className="h-8 w-8 text-amber-300" aria-hidden />
                </div>
                <DialogTitle className="text-2xl text-amber-100">
                  {resultModal.total > 0 ? "Keep studying" : "Could not grade quiz"}
                </DialogTitle>
                <DialogDescription className="text-base text-zinc-300">{resultModal.message}</DialogDescription>
              </DialogHeader>
              {resultModal.total > 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center">
                  <p className="text-3xl font-bold tabular-nums text-amber-200">
                    {resultModal.score}/{resultModal.total}
                  </p>
                  <p className="mt-1 text-sm text-amber-100/80">
                    {certification.passing_score}% required — review the material and retry
                  </p>
                </div>
              ) : null}
              <DialogFooter className="sm:justify-center">
                <Button type="button" variant="outline" onClick={closeResultModal}>
                  Review & retry
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </WorkspacePage>
  )
}
