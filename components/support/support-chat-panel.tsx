"use client"

// Tenant Support chat — text + file uploads, polls for admin replies.

import { useCallback, useEffect, useRef, useState } from "react"
import { Paperclip, Send, ImageIcon, FileText, X } from "lucide-react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { SupportChatMessage, SupportChatThread } from "@/lib/types"

type PendingAttachment = {
  url: string
  filename: string
  content_type: string
  size_bytes: number
}

type ChatPayload = {
  thread: SupportChatThread
  messages: SupportChatMessage[]
}

const fetcher = async (url: string): Promise<ChatPayload> => {
  const res = await fetch(url, { credentials: "include" })
  const json = (await res.json().catch(() => ({}))) as { data?: ChatPayload; error?: string }
  if (!res.ok) throw new Error(json.error ?? "Could not load chat")
  if (!json.data) throw new Error("Empty chat response")
  return json.data
}

function isImageType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/")
}

function formatTime(iso: string): string {
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

export function SupportChatPanel() {
  const { data, error, isLoading, mutate } = useSWR("/api/support/chat", fetcher, {
    refreshInterval: 4000,
    revalidateOnFocus: true,
  })

  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const messages = data?.messages ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/support/chat/upload", {
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
  }, [])

  async function sendMessage() {
    const text = draft.trim()
    if (!text && pending.length === 0) return
    setSending(true)
    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, attachments: pending }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Could not send")
      setDraft("")
      setPending([])
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send")
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      id="support-chat"
      className="flex min-h-[min(420px,70vh)] flex-col overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-sm"
    >
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Chat with Lyncr Support</h2>
            <p className="mt-0.5 hidden text-xs text-muted-foreground md:block">
              Message the team. Attach screenshots or PDFs if helpful.
            </p>
          </div>
          {data?.thread.user_unread_count ? (
            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
              {data.thread.user_unread_count} new
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-7 w-7 text-primary" />
          </div>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
        {!isLoading && !error && messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Say hello — an agent will be with you shortly.
          </p>
        ) : null}
        {messages.map((m) => {
          const isUser = m.sender_type === "user"
          const isSystem = m.sender_type === "system"
          return (
            <div
              key={m.id}
              className={cn(
                "flex",
                isSystem ? "justify-center" : isUser ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[90%] rounded-2xl px-3 py-2 text-sm sm:max-w-[80%]",
                  isSystem &&
                    "max-w-[95%] border border-border/60 bg-muted/40 text-center text-xs text-muted-foreground",
                  isUser && "bg-primary text-primary-foreground",
                  !isUser && !isSystem && "border border-border/70 bg-muted/50 text-foreground"
                )}
              >
                {!isSystem ? (
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                    {isUser ? "You" : "Lyncr Support"}
                  </p>
                ) : null}
                {m.body ? <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p> : null}
                {m.attachments.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {m.attachments.map((a) => (
                      <li key={a.id}>
                        {isImageType(a.content_type) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a href={a.url} target="_blank" rel="noreferrer" className="block">
                            <img
                              src={a.url}
                              alt={a.filename}
                              className="max-h-48 max-w-full rounded-lg border border-black/10 object-contain"
                            />
                          </a>
                        ) : (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              "inline-flex items-center gap-1.5 text-xs underline-offset-2 hover:underline",
                              isUser ? "text-primary-foreground/90" : "text-primary"
                            )}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            {a.filename || "Download file"}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!isSystem ? (
                  <p className="mt-1 text-[10px] opacity-60">{formatTime(m.created_at)}</p>
                ) : null}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {pending.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-border/50 px-3 py-2">
          {pending.map((p) => (
            <span
              key={p.url}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground"
            >
              {isImageType(p.content_type) ? (
                <ImageIcon className="h-3 w-3 shrink-0" />
              ) : (
                <FileText className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">{p.filename}</span>
              <button
                type="button"
                aria-label="Remove attachment"
                className="rounded-full p-0.5 hover:bg-muted"
                onClick={() => setPending((prev) => prev.filter((x) => x.url !== p.url))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="border-t border-border/70 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="flex items-end gap-2">
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
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            disabled={uploading || pending.length >= 5}
            onClick={() => fileRef.current?.click()}
            aria-label="Attach file"
          >
            {uploading ? <Spinner className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message…"
            rows={2}
            maxLength={8000}
            className="min-h-[44px] flex-1 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void sendMessage()
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="shrink-0"
            disabled={sending || (!draft.trim() && pending.length === 0)}
            onClick={() => void sendMessage()}
            aria-label="Send"
          >
            {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
