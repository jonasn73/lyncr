"use client"

// Platform support queue — triage feedback_submissions via /api/admin/feedback.

import { useCallback, useEffect, useState } from "react"
import type { FeedbackStatus, FeedbackSubmission } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"

const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "triaged", "closed"]

export function AdminSupportBoard() {
  const [feedback, setFeedback] = useState<FeedbackSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<FeedbackSubmission | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/feedback?limit=100", { credentials: "include" })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { items?: FeedbackSubmission[] }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Could not load feedback")
      setFeedback(json.data?.items ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setStatus(id: string, status: FeedbackStatus) {
    const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      toast.error(json.error ?? "Could not update status")
      return
    }
    setFeedback((prev) => prev.map((row) => (row.id === id ? { ...row, status } : row)))
    setSheet((prev) => (prev && prev.id === id ? { ...prev, status } : prev))
    toast.success(`Marked ${status}`)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-50">Support</h1>
          <p className="mt-1 text-sm text-slate-500">Newest feedback first. Tap a row to triage.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-slate-700 text-slate-200"
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </div>

      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base text-slate-100">Feedback queue</CardTitle>
          <CardDescription className="text-slate-400">
            Stored on feedback_submissions (billing migration 019 if empty after real submissions).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="h-8 w-8 text-violet-400" />
            </div>
          ) : null}
          {!loading && feedback.length === 0 ? (
            <p className="text-sm text-slate-400">No feedback yet.</p>
          ) : null}
          {feedback.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSheet(row)}
              className="w-full rounded-xl border border-slate-700/80 bg-slate-950/40 p-4 text-left transition-colors hover:border-violet-500/40 hover:bg-slate-900/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase text-slate-500">{row.category}</span>
                <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-300">
                  {row.status}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-slate-100">{row.subject}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-400">{row.body}</p>
              <p className="mt-2 text-xs text-slate-500">{new Date(row.created_at).toLocaleString()}</p>
            </button>
          ))}
        </CardContent>
      </Card>

      <Sheet open={sheet != null} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent
          side="bottom"
          className="gap-0 border-slate-700 bg-slate-950 p-0 text-slate-200 sm:mx-auto sm:max-w-lg"
        >
          {sheet ? (
            <>
              <SheetHeader className="border-b border-slate-800 px-4 py-3 text-left">
                <SheetTitle className="text-slate-50">{sheet.subject}</SheetTitle>
                <p className="text-xs text-slate-500">
                  {sheet.category} · {new Date(sheet.created_at).toLocaleString()}
                </p>
              </SheetHeader>
              <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-medium uppercase text-slate-500">Status</span>
                  <Select
                    value={sheet.status}
                    onValueChange={(v) => void setStatus(sheet.id, v as FeedbackStatus)}
                  >
                    <SelectTrigger className="h-8 w-[140px] border-slate-600 bg-slate-900 text-xs text-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FEEDBACK_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{sheet.body}</p>
              </div>
              <SheetFooter className="border-t border-slate-800 px-4 py-3">
                <Button type="button" variant="ghost" onClick={() => setSheet(null)}>
                  Close
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
