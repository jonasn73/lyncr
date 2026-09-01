"use client"

// Platform support — inbound emails (Resend) + in-app feedback + live chat.

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { useSearchParams } from "next/navigation"
import { startImpersonation } from "@/app/actions/admin-impersonation"
import type {
  AdminSupportEmail,
  AdminSupportEmailListItem,
  FeedbackStatus,
  FeedbackSubmission,
  SupportChatMessage,
  SupportChatThreadListItem,
} from "@/lib/types"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { FileText, ListPlus, Loader2, Paperclip, Send, X } from "lucide-react"

const FEEDBACK_STATUSES: FeedbackStatus[] = ["open", "triaged", "closed"]

/** issue -> bug-priority default; feature request stays lower unless admin bumps it later. */
const FEEDBACK_CATEGORY_TO_BOARD: Record<
  FeedbackSubmission["category"],
  { category: string; priority: "high" | "medium" | "low" }
> = {
  issue: { category: "bug", priority: "high" },
  feature: { category: "feature request", priority: "medium" },
  billing: { category: "billing", priority: "medium" },
  other: { category: "general", priority: "low" },
}

/** Prefer original support@ when Zoho forwarded into Resend. */
function displayToAddress(row: Pick<AdminSupportEmailListItem, "received_for" | "to_email" | "to_emails">) {
  const supportish = [...row.received_for, ...row.to_emails, row.to_email].find((a) =>
    a.toLowerCase().includes("support@")
  )
  return supportish || row.received_for[0] || row.to_email || "—"
}

function formatChatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function isImageType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/")
}

type PendingAttachment = {
  url: string
  filename: string
  content_type: string
  size_bytes: number
}

function LiveChatQueue({ initialThreadId }: { initialThreadId?: string | null }) {
  const [threads, setThreads] = useState<SupportChatThreadListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SupportChatMessage[]>([])
  const [ownerLabel, setOwnerLabel] = useState("")
  const [detailLoading, setDetailLoading] = useState(false)
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeUserId, setActiveUserId] = useState<string | null>(null)
  const [impersonatePending, startImpersonateTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async (opts?: { silent?: boolean }) => {
    // Silent polls must not flip the big spinner — that looked like a reload loop.
    if (!opts?.silent) setLoading(true)
    try {
      const res = await fetch("/api/admin/support-chat?limit=100", { credentials: "include" })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { items?: SupportChatThreadListItem[] }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Could not load conversations")
      setThreads(json.data?.items ?? [])
    } catch (e) {
      if (!opts?.silent) toast.error(e instanceof Error ? e.message : "Load failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadThreads()
    const t = setInterval(() => void loadThreads({ silent: true }), 8000)
    return () => clearInterval(t)
  }, [loadThreads])

  const loadThread = useCallback(async (id: string, silent = false) => {
    if (!silent) setDetailLoading(true)
    setActiveId(id)
    try {
      const res = await fetch(`/api/admin/support-chat/${encodeURIComponent(id)}`, {
        credentials: "include",
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: {
          messages?: SupportChatMessage[]
          owner?: { id?: string; business_name?: string; name?: string; email?: string } | null
        }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Could not open conversation")
      setMessages(json.data?.messages ?? [])
      const o = json.data?.owner
      setActiveUserId(o?.id?.trim() || null)
      setOwnerLabel(
        o
          ? `${o.business_name || "Business"} · ${o.name || ""} · ${o.email || ""}`.replace(/\s·\s$/, "")
          : "Tenant"
      )
      setThreads((prev) =>
        prev.map((row) => (row.id === id ? { ...row, admin_unread_count: 0 } : row))
      )
    } catch (e) {
      if (!silent) {
        toast.error(e instanceof Error ? e.message : "Open failed")
        setActiveId(null)
      }
    } finally {
      if (!silent) setDetailLoading(false)
    }
  }, [])

  // Deep link from the notification bell (?tab=chat&thread=…) — open once, not on every rerender.
  const openedInitialThread = useRef(false)
  useEffect(() => {
    if (openedInitialThread.current || !initialThreadId) return
    openedInitialThread.current = true
    void loadThread(initialThreadId)
  }, [initialThreadId, loadThread])

  // Poll open thread for new tenant messages.
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(() => void loadThread(activeId, true), 4000)
    return () => clearInterval(t)
  }, [activeId, loadThread])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  async function uploadFile(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/admin/support-chat/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: PendingAttachment
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Upload failed")
      if (!json.data?.url) throw new Error("Upload returned no URL")
      setPending((prev) => [...prev, json.data!].slice(0, 5))
      toast.success("File attached")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function sendReply() {
    if (!activeId) return
    const text = draft.trim()
    if (!text && pending.length === 0) return
    setSending(true)
    try {
      const res = await fetch(`/api/admin/support-chat/${encodeURIComponent(activeId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, attachments: pending }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { message?: SupportChatMessage }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "Could not send")
      if (json.data?.message) {
        setMessages((prev) => [...prev, json.data!.message!])
      }
      setDraft("")
      setPending([])
      void loadThreads()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send")
    } finally {
      setSending(false)
    }
  }

  async function closeThread() {
    if (!activeId) return
    const res = await fetch(`/api/admin/support-chat/${encodeURIComponent(activeId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    })
    if (!res.ok) {
      toast.error("Could not close conversation")
      return
    }
    toast.success("Marked closed")
    setActiveId(null)
    void loadThreads()
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border text-foreground"
          onClick={() => void loadThreads({ silent: true })}
        >
          Refresh
        </Button>
      </div>
      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Live chat</CardTitle>
          <CardDescription className="hidden text-muted-foreground md:block">
            In-app conversations from Help → Chat with Lyncr Support. Newest activity first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && threads.length === 0 ? (
            <div className="flex justify-center py-10">
              <Spinner className="h-9 w-9 text-operator" />
            </div>
          ) : null}
          {!loading && threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No conversations yet. When a business owner messages from Help, it shows here.
            </p>
          ) : null}
          {threads.map((row) => {
            const unread = row.admin_unread_count > 0
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => void loadThread(row.id)}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-colors",
                  unread
                    ? "border-operator/40 bg-background/60 hover:border-operator/60"
                    : "border-border/80 bg-background/40 hover:border-border"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("text-sm", unread ? "font-semibold text-foreground" : "text-foreground")}>
                    {row.business_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.last_message_at
                      ? formatChatTime(row.last_message_at)
                      : formatChatTime(row.created_at)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.owner_name} · {row.owner_email} · {row.status}
                  {unread ? (
                    <span className="ml-2 rounded-full bg-operator/20 px-2 py-0.5 text-2xs font-medium text-operator">
                      {row.admin_unread_count} unread
                    </span>
                  ) : null}
                </p>
                {row.last_message_preview ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{row.last_message_preview}</p>
                ) : null}
              </button>
            )
          })}
        </CardContent>
      </Card>

      <Sheet
        open={activeId != null}
        onOpenChange={(o) => {
          if (!o) {
            setActiveId(null)
            setActiveUserId(null)
            setMessages([])
            setDraft("")
            setPending([])
          }
        }}
      >
        <SheetContent
          side="bottom"
          className="flex max-h-[92vh] flex-col gap-0 border-border bg-background p-0 text-foreground sm:mx-auto sm:max-w-lg"
        >
          <SheetHeader className="border-b border-border px-4 py-3 text-left">
            <div className="flex items-start justify-between gap-2 pr-8">
              <div className="min-w-0">
                <SheetTitle className="text-foreground">Support chat</SheetTitle>
                <p className="text-xs text-muted-foreground">{ownerLabel}</p>
              </div>
              {activeUserId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={impersonatePending}
                  className="shrink-0 border-border bg-card text-foreground hover:bg-muted"
                  onClick={() => {
                    startImpersonateTransition(async () => {
                      const result = await startImpersonation(activeUserId)
                      if (result?.ok === false) toast.error(result.error)
                    })
                  }}
                >
                  {impersonatePending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  View as owner
                </Button>
              ) : null}
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {detailLoading && messages.length === 0 ? (
              <div className="flex justify-center py-12">
                <Spinner className="h-9 w-9 text-operator" />
              </div>
            ) : null}
            {messages.map((m) => {
              const isAdmin = m.sender_type === "admin"
              const isSystem = m.sender_type === "system"
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex",
                    isSystem ? "justify-center" : isAdmin ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[90%] rounded-2xl px-3 py-2 text-sm",
                      isSystem &&
                        "max-w-[95%] border border-border bg-card/80 text-center text-xs text-muted-foreground",
                      isAdmin && "bg-operator text-operator-foreground",
                      !isAdmin && !isSystem && "border border-border bg-card text-foreground"
                    )}
                  >
                    {!isSystem ? (
                      <p className="mb-0.5 text-micro font-medium uppercase tracking-wide opacity-70">
                        {isAdmin ? "You (Lyncr)" : "Tenant"}
                      </p>
                    ) : null}
                    {m.body ? <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p> : null}
                    {m.attachments.map((a) => (
                      <div key={a.id} className="mt-2">
                        {isImageType(a.content_type) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a href={a.url} target="_blank" rel="noreferrer">
                            <img
                              src={a.url}
                              alt={a.filename}
                              className="max-h-40 max-w-full rounded-lg object-contain"
                            />
                          </a>
                        ) : (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs underline"
                          >
                            <FileText className="h-3 w-3" />
                            {a.filename}
                          </a>
                        )}
                      </div>
                    ))}
                    {!isSystem ? (
                      <p className="mt-1 text-2xs opacity-60">{formatChatTime(m.created_at)}</p>
                    ) : null}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {pending.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
              {pending.map((p) => (
                <span
                  key={p.url}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-2xs"
                >
                  <span className="max-w-[140px] truncate">{p.filename}</span>
                  <button
                    type="button"
                    onClick={() => setPending((prev) => prev.filter((x) => x.url !== p.url))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="border-t border-border px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadFile(f)
              }}
            />
            <div className="flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0 border-border"
                disabled={uploading || pending.length >= 5}
                onClick={() => fileRef.current?.click()}
                aria-label="Attach file"
              >
                {uploading ? <Spinner className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Reply as Lyncr Support…"
                rows={2}
                className="min-h-[44px] flex-1 resize-none border-border bg-card text-foreground"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    void sendReply()
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                className="shrink-0 bg-operator hover:bg-operator"
                disabled={sending || (!draft.trim() && pending.length === 0)}
                onClick={() => void sendReply()}
                aria-label="Send"
              >
                {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <SheetFooter className="mt-2 flex-row justify-between gap-2 border-0 p-0 sm:justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={() => setActiveId(null)}>
                Close
              </Button>
              <Button type="button" variant="outline" size="sm" className="border-border" onClick={() => void closeThread()}>
                Mark closed
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function FeedbackQueue({ initialFeedbackId }: { initialFeedbackId?: string | null }) {
  const [feedback, setFeedback] = useState<FeedbackSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<FeedbackSubmission | null>(null)
  const [addingToBoard, setAddingToBoard] = useState(false)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
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

  // Deep link from the notification bell (?tab=feedback&feedback=…) — open once the list has
  // loaded and the row is available, not on every rerender.
  const openedInitialFeedback = useRef(false)
  useEffect(() => {
    if (openedInitialFeedback.current || !initialFeedbackId || feedback.length === 0) return
    const row = feedback.find((r) => r.id === initialFeedbackId)
    if (!row) return
    openedInitialFeedback.current = true
    setSheet(row)
  }, [initialFeedbackId, feedback])

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

  /** Promote a user-submitted bug/feature report onto the App Improvement Board. */
  async function addToBoard(row: FeedbackSubmission) {
    setAddingToBoard(true)
    try {
      const mapped = FEEDBACK_CATEGORY_TO_BOARD[row.category] ?? FEEDBACK_CATEGORY_TO_BOARD.other
      const res = await fetch("/api/admin/improvements", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: row.subject,
          description: row.body,
          category: mapped.category,
          priority: mapped.priority,
          source: "User feedback",
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? "Could not add to the board")
        return
      }
      toast.success("Added to the App Improvement Board")
      if (row.status === "open") await setStatus(row.id, "triaged")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add to the board")
    } finally {
      setAddingToBoard(false)
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-border text-foreground"
          onClick={() => void load({ silent: true })}
        >
          Refresh
        </Button>
      </div>
      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">Feedback queue</CardTitle>
          <CardDescription className="hidden text-muted-foreground md:block">
            In-app Help submissions (feedback_submissions). Newest first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && feedback.length === 0 ? (
            <div className="flex justify-center py-10">
              <Spinner className="h-9 w-9 text-operator" />
            </div>
          ) : null}
          {!loading && feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback yet.</p>
          ) : null}
          {feedback.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSheet(row)}
              className="w-full rounded-xl border border-border/80 bg-background/40 p-4 text-left transition-colors hover:border-operator/40 hover:bg-card/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">{row.category}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-2xs font-medium capitalize text-foreground">
                  {row.status}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-foreground">{row.subject}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{row.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</p>
            </button>
          ))}
        </CardContent>
      </Card>

      <Sheet open={sheet != null} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent
          side="bottom"
          className="gap-0 border-border bg-background p-0 text-foreground sm:mx-auto sm:max-w-lg"
        >
          {sheet ? (
            <>
              <SheetHeader className="border-b border-border px-4 py-3 text-left">
                <SheetTitle className="text-foreground">{sheet.subject}</SheetTitle>
                <p className="text-xs text-muted-foreground">
                  {sheet.category} · {new Date(sheet.created_at).toLocaleString()}
                </p>
              </SheetHeader>
              <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-micro font-medium uppercase text-muted-foreground">Status</span>
                  <Select
                    value={sheet.status}
                    onValueChange={(v) => void setStatus(sheet.id, v as FeedbackStatus)}
                  >
                    <SelectTrigger className="h-9 w-[140px] border-border bg-card text-xs text-foreground">
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{sheet.body}</p>
              </div>
              <SheetFooter className="flex-row justify-between gap-2 border-t border-border px-4 py-3 sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => setSheet(null)}>
                  Close
                </Button>
                <Button
                  type="button"
                  className="bg-operator text-operator-foreground hover:bg-operator"
                  disabled={addingToBoard}
                  onClick={() => void addToBoard(sheet)}
                >
                  {addingToBoard ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <ListPlus className="mr-1.5 h-4 w-4" aria-hidden />
                  )}
                  Add to Improvement Board
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

function EmailInbox({ initialEmailId }: { initialEmailId?: string | null }) {
  const [emails, setEmails] = useState<AdminSupportEmailListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<AdminSupportEmail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
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

  // Deep link from the notification bell (?tab=emails&email=…) — open once, not on every rerender.
  const openedInitialEmail = useRef(false)
  useEffect(() => {
    if (openedInitialEmail.current || !initialEmailId) return
    openedInitialEmail.current = true
    void openEmail(initialEmailId)
  }, [initialEmailId])

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
          className="border-border text-foreground"
          onClick={() => void load({ silent: true })}
        >
          Refresh
        </Button>
      </div>
      <Card className="border-border bg-card/50">
        <CardHeader>
          <CardTitle className="text-base text-foreground">support@lyncr.app</CardTitle>
          <CardDescription className="hidden text-muted-foreground md:block">
            Inbound via Zoho forward → Resend. Setup: ADMIN-SUPPORT-INBOX.md + Neon migration 127.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && emails.length === 0 ? (
            <div className="flex justify-center py-10">
              <Spinner className="h-9 w-9 text-operator" />
            </div>
          ) : null}
          {!loading && emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">
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
                    ? "border-operator/40 bg-background/60 hover:border-operator/60"
                    : "border-border/80 bg-background/40 hover:border-border"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("text-sm", unread ? "font-semibold text-foreground" : "text-foreground")}>
                    {row.from_name ? `${row.from_name} · ${row.from_email}` : row.from_email}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(row.received_at).toLocaleString()}</span>
                </div>
                <p className={cn("mt-1 text-sm", unread ? "font-medium text-foreground" : "text-foreground")}>
                  {row.subject || "(no subject)"}
                  {unread ? (
                    <span className="ml-2 rounded-full bg-operator/20 px-2 py-0.5 text-2xs font-medium text-operator">
                      Unread
                    </span>
                  ) : null}
                </p>
                {row.text_preview ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{row.text_preview}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">To {displayToAddress(row)}</p>
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
          className="gap-0 border-border bg-background p-0 text-foreground sm:mx-auto sm:max-w-lg"
        >
          {detailLoading && !detail ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-9 w-9 text-operator" />
            </div>
          ) : null}
          {detail ? (
            <>
              <SheetHeader className="border-b border-border px-4 py-3 text-left">
                <SheetTitle className="text-foreground">{detail.subject || "(no subject)"}</SheetTitle>
                <p className="text-xs text-muted-foreground">
                  From {detail.from_name ? `${detail.from_name} <${detail.from_email}>` : detail.from_email}
                  {" · "}
                  {new Date(detail.received_at).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">To {displayToAddress(detail)}</p>
              </SheetHeader>
              <div className="max-h-[min(70vh,520px)] space-y-3 overflow-y-auto px-4 py-3">
                {detail.text_body ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{detail.text_body}</p>
                ) : detail.html_body ? (
                  // Sandboxed iframe avoids executing scripts from email HTML.
                  <iframe
                    title="Email HTML"
                    sandbox=""
                    className="min-h-[240px] w-full rounded-lg border border-border bg-white"
                    srcDoc={detail.html_body}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No body content stored for this message.</p>
                )}
                <p className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-muted-foreground">
                  Reply coming soon — for now, reply from Zoho if you keep a copy there.
                </p>
              </div>
              <SheetFooter className="border-t border-border px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
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
  // Deep link from the notification bell: /admin/support?tab=chat&thread=… (also emails/feedback).
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")
  const initialTab = tabParam === "emails" || tabParam === "feedback" ? tabParam : "chat"
  const [tab, setTab] = useState(initialTab)
  const initialThreadId = searchParams.get("thread")
  const initialEmailId = searchParams.get("email")
  const initialFeedbackId = searchParams.get("feedback")

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Support</h1>
        <p className="mt-1 hidden text-sm text-muted-foreground md:block">
          Live chat, emails to support@lyncr.app, and in-app feedback. Tap a row for details.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-3 bg-card p-1">
          <TabsTrigger
            value="chat"
            className="data-[state=active]:bg-muted data-[state=active]:text-foreground"
          >
            Live chat
          </TabsTrigger>
          <TabsTrigger
            value="emails"
            className="data-[state=active]:bg-muted data-[state=active]:text-foreground"
          >
            Emails
          </TabsTrigger>
          <TabsTrigger
            value="feedback"
            className="data-[state=active]:bg-muted data-[state=active]:text-foreground"
          >
            In-app feedback
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-4">
          <LiveChatQueue initialThreadId={initialThreadId} />
        </TabsContent>
        <TabsContent value="emails" className="mt-4">
          <EmailInbox initialEmailId={initialEmailId} />
        </TabsContent>
        <TabsContent value="feedback" className="mt-4">
          <FeedbackQueue initialFeedbackId={initialFeedbackId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
