"use client"

// App Improvement Board — admin backlog of app development improvements.
// Log ideas, decide what to tackle (Planned), track work (In Progress), mark Done, or remove.

import { useMemo, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type {
  AppImprovement,
  AppImprovementPriority,
  AppImprovementStatus,
} from "@/lib/app-improvements"

const COLUMNS: { status: AppImprovementStatus; label: string; hint: string }[] = [
  { status: "backlog", label: "Backlog", hint: "Logged, not yet decided" },
  { status: "planned", label: "Planned", hint: "Admin will tackle this" },
  { status: "in_progress", label: "In Progress", hint: "Being worked on now" },
  { status: "done", label: "Done", hint: "Shipped" },
]

const PRIORITIES: AppImprovementPriority[] = ["high", "medium", "low"]
const CATEGORY_SUGGESTIONS = [
  "general",
  "amber",
  "payments",
  "scheduler",
  "crm",
  "usability",
  "testing",
  "user feedback",
]

const PRIORITY_BADGE_CLASS: Record<AppImprovementPriority, string> = {
  high: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-border bg-muted/60 text-muted-foreground",
}

function emptyDraft(): {
  title: string
  description: string
  category: string
  priority: AppImprovementPriority
} {
  return { title: "", description: "", category: "general", priority: "medium" }
}

export function AdminImprovementsBoard({
  initialItems,
}: {
  initialItems: AppImprovement[]
}) {
  const [items, setItems] = useState<AppImprovement[]>(initialItems)
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft())
  const [saving, setSaving] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AppImprovement | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const byStatus = useMemo(() => {
    const map: Record<AppImprovementStatus, AppImprovement[]> = {
      backlog: [],
      planned: [],
      in_progress: [],
      done: [],
    }
    for (const item of items) map[item.status].push(item)
    return map
  }, [items])

  async function submitNew() {
    const title = draft.title.trim()
    if (title.length < 3) {
      toast.error("Title must be at least 3 characters")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/admin/improvements", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: draft.description.trim() || null,
          category: draft.category.trim() || "general",
          priority: draft.priority,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: AppImprovement
        error?: string
      }
      if (!res.ok || !json.data) {
        toast.error(json.error ?? "Could not save the improvement")
        return
      }
      setItems((prev) => [json.data!, ...prev])
      setDraft(emptyDraft())
      setAddOpen(false)
      toast.success("Added to the board")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the improvement")
    } finally {
      setSaving(false)
    }
  }

  async function moveStatus(item: AppImprovement, status: AppImprovementStatus) {
    if (status === item.status) return
    setMovingId(item.id)
    const previous = items
    setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, status } : row)))
    try {
      const res = await fetch(`/api/admin/improvements/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        setItems(previous)
        toast.error(json.error ?? "Could not move that item")
      }
    } catch (e) {
      setItems(previous)
      toast.error(e instanceof Error ? e.message : "Could not move that item")
    } finally {
      setMovingId(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const res = await fetch(`/api/admin/improvements/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(json.error ?? "Could not remove that item")
        return
      }
      setItems((prev) => prev.filter((row) => row.id !== deleteTarget.id))
      toast.success("Removed from the board")
      setDeleteTarget(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove that item")
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">App Improvement Board</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ideas, bugs, and roadmap items — decide what to tackle, track progress, mark done, or
            take it off the list.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button type="button" className="bg-violet-600 text-white hover:bg-violet-500">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Add improvement
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add improvement</DialogTitle>
              <DialogDescription>Logs to Backlog — move it to Planned when you decide to tackle it.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Title</Label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="e.g. Amber: multi-turn draft refinement"
                  className="border-border bg-background text-foreground"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Description</Label>
                <Textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="What is it, why it matters, any context."
                  rows={4}
                  className="border-border bg-background text-foreground"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Category</Label>
                  <Input
                    value={draft.category}
                    onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                    list="improvement-category-suggestions"
                    className="border-border bg-background text-foreground"
                  />
                  <datalist id="improvement-category-suggestions">
                    {CATEGORY_SUGGESTIONS.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Priority</Label>
                  <Select
                    value={draft.priority}
                    onValueChange={(v) => setDraft((d) => ({ ...d, priority: v as AppImprovementPriority }))}
                  >
                    <SelectTrigger className="border-border bg-background text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p[0].toUpperCase() + p.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void submitNew()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const rows = byStatus[col.status]
          return (
            <div key={col.status} className="space-y-3">
              <div className="flex items-baseline justify-between px-1">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{col.label}</h2>
                  <p className="text-2xs text-muted-foreground">{col.hint}</p>
                </div>
                <Badge variant="outline" className="border-border text-muted-foreground">
                  {rows.length}
                </Badge>
              </div>
              <div className="space-y-2">
                {rows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Nothing here
                  </p>
                ) : (
                  rows.map((item) => (
                    <Card key={item.id} className="border-border bg-card/50">
                      <CardHeader className="space-y-2 pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold leading-snug text-foreground">
                            {item.title}
                          </p>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(item)}
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400"
                            aria-label={`Remove ${item.title} from the board`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn("text-micro", PRIORITY_BADGE_CLASS[item.priority])}
                          >
                            {item.priority}
                          </Badge>
                          <Badge variant="outline" className="border-border text-micro text-muted-foreground">
                            {item.category}
                          </Badge>
                          {item.source ? (
                            <Badge variant="outline" className="border-sky-700/50 text-micro text-sky-400">
                              {item.source}
                            </Badge>
                          ) : null}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-0">
                        {item.description ? (
                          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                            {item.description}
                          </p>
                        ) : null}
                        <Select
                          value={item.status}
                          onValueChange={(v) => void moveStatus(item, v as AppImprovementStatus)}
                          disabled={movingId === item.id}
                        >
                          <SelectTrigger className="h-9 border-border bg-background text-xs text-foreground">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COLUMNS.map((c) => (
                              <SelectItem key={c.status} value={c.status}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from the board?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” will be permanently removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
            >
              {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
