"use client"

// Platform support — inbound emails (Resend) + in-app feedback_submissions.

import { useCallback, useEffect, useState } from "react"
import type { AdminSupportEmail, AdminSupportEmailListItem, FeedbackStatus, FeedbackSubmission } from "@/lib/types"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "triaged", "closed"]

/** Prefer original support@ when Zoho forwarded into Resend. */
function displayToAddress(row: Pick<AdminSupportEmailListItem, "received_for" | "to_email" | "to_emails">) {
  const supportish = [...row.received_for, ...row.to_emails, row.to_email].find((a) =>
    a.toLowerCase().includes("support@")
  )
  return supportish || row.received_for[0] || row.to_email || "—"
}

function FeedbackQueue() {
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
    <>
      <div className="mb-3 flex justify-end">
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
          <CardDescription className="hidden text-slate-400 md:block">
            In-app Help submissions (feedback_submissions). Newest first.
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
    </>
  )
}

function EmailInbox() {
  const [emails, setEmails] = useState<AdminSupportEmailListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<AdminSupportEmail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/support-emails?limit=50", { credentials: "include" })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { items?: AdminSupportEmailListItem[] }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Could not load emails")
      setEmails(json.data?.items ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function openEmail(id: string) {
    setDetailLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/admin/support-emails/${encodeURIComponent(id)}`, {
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: AdminSupportEmail
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Could not open email")
      const item = json.data ?? null
      setDetail(item)
      // Mark read when opened
      if (item && !item.read_at) {
        const patch = await fetch(`/api/admin/support-emails/${encodeURIComponent(id)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: true }),
        })
        if (patch.ok) {
          const patched = (await patch.json().catch(() => ({}))) as { data?: AdminSupportEmail }
          if (patched.data) setDetail(patched.data)
          setEmails((prev) =>
            prev.map((row) =>
              row.id === id ? { ...row, read_at: patched.data?.read_at ?? new Date().toISOString() } : row
            )
          )
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Open failed")
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
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
          <CardTitle className="text-base text-slate-100">support@lyncr.app</CardTitle>
          <CardDescription className="hidden text-slate-400 md:block">
            Inbound via Zoho forward → Resend. Setup: ADMIN-SUPPORT-INBOX.md + Neon migration 127.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="h-8 w-8 text-violet-400" />
            </div>
          ) : null}
          {!loading && emails.length === 0 ? (
            <p className="text-sm text-slate-400">
              No emails yet. After Zoho forwarding and Resend webhook are set up, messages to
              support@lyncr.app show here.
            </p>
          ) : null}
          {emails.map((row) => {
            const unread = !row.read_at
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => void openEmail(row.id)}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-colors",
                  unread
                    ? "border-violet-500/40 bg-slate-950/60 hover:border-violet-400/60"
                    : "border-slate-700/80 bg-slate-950/40 hover:border-slate-600"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("text-sm", unread ? "font-semibold text-slate-50" : "text-slate-200")}>
                    {row.from_name ? `${row.from_name} · ${row.from_email}` : row.from_email}
                  </span>
                  <span className="text-xs text-slate-500">{new Date(row.received_at).toLocaleString()}</span>
                </div>
                <p className={cn("mt-1 text-sm", unread ? "font-medium text-slate-100" : "text-slate-300")}>
                  {row.subject || "(no subject)"}
                  {unread ? (
                    <span className="ml-2 rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                      Unread
                    </span>
                  ) : null}
                </p>
                {row.text_preview ? (
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">{row.text_preview}</p>
                ) : null}
                <p className="mt-2 text-xs text-slate-600">To {displayToAddress(row)}</p>
              </button>
            )
          })}
        </CardContent>
      </Card>

      <Sheet
        open={detail != null || detailLoading}
        onOpenChange={(o) => {
          if (!o) {
            setDetail(null)
            setDetailLoading(false)
          }
        }}
      >
        <SheetContent
          side="bottom"
          className="gap-0 border-slate-700 bg-slate-950 p-0 text-slate-200 sm:mx-auto sm:max-w-lg"
        >
          {detailLoading && !detail ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-8 w-8 text-violet-400" />
            </div>
          ) : null}
          {detail ? (
            <>
              <SheetHeader className="border-b border-slate-800 px-4 py-3 text-left">
                <SheetTitle className="text-slate-50">{detail.subject || "(no subject)"}</SheetTitle>
                <p className="text-xs text-slate-500">
                  From {detail.from_name ? `${detail.from_name} <${detail.from_email}>` : detail.from_email}
                  {" · "}
                  {new Date(detail.received_at).toLocaleString()}
                </p>
                <p className="text-xs text-slate-600">To {displayToAddress(detail)}</p>
              </SheetHeader>
              <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto px-4 py-3">
                {detail.text_body ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{detail.text_body}</p>
                ) : detail.html_body ? (
                  // Sandboxed iframe avoids executing scripts from email HTML.
                  <iframe
                    title="Email HTML"
                    sandbox=""
                    className="min-h-[240px] w-full rounded-lg border border-slate-800 bg-white"
                    srcDoc={detail.html_body}
                  />
                ) : (
                  <p className="text-sm text-slate-500">No body content stored for this message.</p>
                )}
                <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-500">
                  Reply coming soon — for now, reply from Zoho if you keep a copy there.
                </p>
              </div>
              <SheetFooter className="border-t border-slate-800 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <Button type="button" variant="ghost" onClick={() => setDetail(null)}>
                  Close
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

export function AdminSupportBoard() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-50">Support</h1>
        <p className="mt-1 hidden text-sm text-slate-500 md:block">
          Emails to support@lyncr.app and in-app feedback. Tap a row for details.
        </p>
      </div>

      <Tabs defaultValue="emails" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-2 bg-slate-900 p-1">
          <TabsTrigger
            value="emails"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-slate-50"
          >
            Emails
          </TabsTrigger>
          <TabsTrigger
            value="feedback"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-slate-50"
          >
            In-app feedback
          </TabsTrigger>
        </TabsList>
        <TabsContent value="emails" className="mt-4">
          <EmailInbox />
        </TabsContent>
        <TabsContent value="feedback" className="mt-4">
          <FeedbackQueue />
        </TabsContent>
      </Tabs>
    </div>
  )
}
