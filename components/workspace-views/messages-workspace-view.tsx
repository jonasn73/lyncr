"use client"

// Owner Messages inbox — thread list + conversation + reply (polls GET /api/messaging).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Loader2, MessageSquare, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
  MOBILE_PANEL_VIEWPORT_MIN_H,
} from "@/components/dashboard-workspace-ui"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import type { SmsMessage } from "@/lib/types"

type SmsThread = {
  customerPhone: string
  messages: SmsMessage[]
  lastMessage: SmsMessage
  needsReply: boolean
}

function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function groupIntoThreads(messages: SmsMessage[]): SmsThread[] {
  const byPhone = new Map<string, SmsMessage[]>()
  for (const msg of messages) {
    const key = msg.customer_phone?.trim() || msg.from_number
    if (!key) continue
    const list = byPhone.get(key) ?? []
    list.push(msg)
    byPhone.set(key, list)
  }

  const threads: SmsThread[] = []
  for (const [customerPhone, list] of byPhone) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const lastMessage = sorted[sorted.length - 1]
    if (!lastMessage) continue
    threads.push({
      customerPhone,
      messages: sorted,
      lastMessage,
      needsReply: lastMessage.direction === "inbound",
    })
  }

  threads.sort(
    (a, b) =>
      new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
  )
  return threads
}

export const MessagesWorkspaceView = memo(function MessagesWorkspaceView() {
  const { activeOrganizationId } = useDashboardWorkspace()
  const orgId =
    activeOrganizationId && !activeOrganizationId.startsWith("legacy-")
      ? activeOrganizationId
      : null

  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const loadMessages = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      setError(null)
      try {
        const qs = orgId
          ? `?organization_id=${encodeURIComponent(orgId)}&limit=200`
          : "?limit=200"
        const res = await fetch(`/api/messaging${qs}`, {
          credentials: "include",
          cache: "no-store",
        })
        const json = (await res.json()) as {
          error?: string
          data?: { messages?: SmsMessage[] }
        }
        if (!res.ok) throw new Error(json.error || "Could not load messages")
        setMessages(Array.isArray(json.data?.messages) ? json.data!.messages! : [])
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load messages")
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [orgId]
  )

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  // Poll while this workspace is mounted so new customer replies show up.
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadMessages({ silent: true })
    }, 12_000)
    return () => window.clearInterval(id)
  }, [loadMessages])

  const threads = useMemo(() => groupIntoThreads(messages), [messages])

  const activeThread = useMemo(
    () => threads.find((t) => t.customerPhone === selectedPhone) ?? null,
    [threads, selectedPhone]
  )

  useEffect(() => {
    if (!selectedPhone) return
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [selectedPhone, activeThread?.messages.length])

  async function sendReply() {
    const to = selectedPhone
    const text = draft.trim()
    if (!to || !text || sending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch("/api/messaging/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          text,
          organization_id: orgId || undefined,
        }),
      })
      const json = (await res.json()) as {
        error?: string
        data?: { message?: SmsMessage | null; delivery_warning?: string | null }
      }
      if (!res.ok) throw new Error(json.error || "Could not send message")
      if (json.data?.message) {
        setMessages((prev) => [json.data!.message!, ...prev])
      } else {
        await loadMessages({ silent: true })
      }
      if (json.data?.delivery_warning) {
        setSendError(json.data.delivery_warning)
      }
      setDraft("")
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not send message")
    } finally {
      setSending(false)
    }
  }

  return (
    <WorkspacePage className="pb-8">
      <WorkspacePageHeader
        eyebrow="SMS"
        title="Messages"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadMessages()}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
          </Button>
        }
      />

      <p className="max-w-2xl text-sm text-muted-foreground">
        Texts to and from your business line — including Missed Call Rescue textbacks and customer
        replies. Select a conversation to reply.
      </p>

      {error ? (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <WorkspacePanel
        className={cn(
          "grid overflow-hidden md:grid-cols-[minmax(240px,320px)_1fr]",
          MOBILE_PANEL_VIEWPORT_MIN_H
        )}
      >
        {/* Thread list — hidden on mobile when a conversation is open */}
        <div
          className={cn(
            "flex min-h-[50vh] flex-col border-border/60 md:min-h-0 md:border-r",
            selectedPhone ? "hidden md:flex" : "flex"
          )}
        >
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conversations
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && threads.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading messages…
              </div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/50" aria-hidden />
                <p className="text-sm font-medium text-foreground">No texts yet</p>
                <p className="text-xs text-muted-foreground">
                  When Missed Call Rescue texts a booking link, or a customer texts your line, the
                  thread shows up here.
                </p>
              </div>
            ) : (
              threads.map((thread) => {
                const active = thread.customerPhone === selectedPhone
                return (
                  <button
                    key={thread.customerPhone}
                    type="button"
                    onClick={() => {
                      setSelectedPhone(thread.customerPhone)
                      setSendError(null)
                    }}
                    className={cn(
                      "flex w-full flex-col gap-0.5 border-b border-border/40 px-4 py-3 text-left transition-colors",
                      active
                        ? "bg-emerald-500/10"
                        : "hover:bg-muted/40",
                      thread.needsReply && !active && "bg-amber-500/5"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {formatPhoneDisplay(thread.customerPhone)}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {formatMessageTime(thread.lastMessage.created_at)}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "truncate text-xs",
                        thread.needsReply
                          ? "font-medium text-amber-100/90"
                          : "text-muted-foreground"
                      )}
                    >
                      {thread.lastMessage.direction === "outbound" ? "You: " : ""}
                      {thread.lastMessage.body}
                    </p>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Conversation pane */}
        <div
          className={cn(
            "flex min-h-[50vh] flex-col md:min-h-0",
            selectedPhone ? "flex" : "hidden md:flex"
          )}
        >
          {!activeThread ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 opacity-40" aria-hidden />
              <p className="text-sm">Select a conversation to read and reply</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border/60 px-3 py-3 md:px-4">
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground md:hidden"
                  aria-label="Back to conversations"
                  onClick={() => setSelectedPhone(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {formatPhoneDisplay(activeThread.customerPhone)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {activeThread.messages.length} message
                    {activeThread.messages.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4 md:px-4">
                {activeThread.messages.map((msg) => {
                  const outbound = msg.direction === "outbound"
                  return (
                    <div
                      key={msg.id}
                      className={cn("flex", outbound ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug",
                          outbound
                            ? "rounded-br-md bg-emerald-600 text-white"
                            : "rounded-bl-md border border-border/60 bg-muted/50 text-foreground"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                        <p
                          className={cn(
                            "mt-1 text-[10px] tabular-nums",
                            outbound ? "text-emerald-100/80" : "text-muted-foreground"
                          )}
                        >
                          {formatMessageTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-border/60 px-3 py-3 md:px-4">
                {sendError ? (
                  <p className="mb-2 text-xs text-red-300">{sendError}</p>
                ) : null}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a reply…"
                    rows={2}
                    disabled={sending}
                    className="min-h-[44px] flex-1 resize-none bg-background"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        void sendReply()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    disabled={sending || !draft.trim()}
                    onClick={() => void sendReply()}
                    className="shrink-0 bg-emerald-600 hover:bg-emerald-500"
                    aria-label="Send reply"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
})
