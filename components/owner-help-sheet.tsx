"use client"

// Compact owner Help sheet — chat + report a problem, same APIs as /dashboard/help.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LifeBuoy, MessageCircle, Send } from "lucide-react"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  OPEN_OWNER_HELP_SHEET_EVENT,
  type OwnerHelpSheetTab,
} from "@/lib/owner-help-events"
import { describeBrowserDevice } from "@/lib/help-feedback-context"

/** Mobile-first Help sheet hosted in the dashboard shell. */
export function OwnerHelpSheet() {
  const { toast } = useToast()
  const pathname = usePathname() ?? "/dashboard"
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<OwnerHelpSheetTab>("chat")
  const [chatText, setChatText] = useState("")
  const [reportText, setReportText] = useState("")
  const [sendingChat, setSendingChat] = useState(false)
  const [sendingReport, setSendingReport] = useState(false)

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<{ tab?: OwnerHelpSheetTab }>).detail
      setTab(detail?.tab === "report" ? "report" : "chat")
      setOpen(true)
    }
    window.addEventListener(OPEN_OWNER_HELP_SHEET_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_OWNER_HELP_SHEET_EVENT, onOpen)
  }, [])

  const sendChat = useCallback(async () => {
    const body = chatText.trim()
    if (body.length < 2) {
      toast({ title: "Type a short message first", variant: "destructive" })
      return
    }
    setSendingChat(true)
    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not send")
      setChatText("")
      toast({ title: "Sent", description: "Lyncr Support will reply in Help chat." })
    } catch (e) {
      toast({
        title: "Could not send",
        description: e instanceof Error ? e.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setSendingChat(false)
    }
  }, [chatText, toast])

  const sendReport = useCallback(async () => {
    const note = reportText.trim()
    if (note.length < 10) {
      toast({ title: "Please add a bit more detail (10+ characters)", variant: "destructive" })
      return
    }
    setSendingReport(true)
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "issue",
          subject: "Problem report",
          body: note,
          page_path: pathname,
          page_name: pathname.replace(/^\/dashboard\/?/, "") || "dashboard",
          device: describeBrowserDevice(typeof navigator !== "undefined" ? navigator.userAgent : ""),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || "Could not send")
      setReportText("")
      toast({ title: "Thanks", description: "We received your note on the support board." })
      setOpen(false)
    } catch (e) {
      toast({
        title: "Could not send",
        description: e instanceof Error ? e.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setSendingReport(false)
    }
  }, [pathname, reportText, toast])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:mx-auto sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border/70 px-4 py-3 text-left">
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-primary" aria-hidden />
            <SheetTitle className="text-base">Help</SheetTitle>
          </div>
          <p className="hidden text-xs text-muted-foreground md:block">
            Chat with Lyncr or report a problem. Same inbox as Admin → Support.
          </p>
        </SheetHeader>

        <div className="flex gap-1 border-b border-border/60 px-3 pt-2">
          <button
            type="button"
            className={cn(
              "rounded-t-lg px-3 py-2 text-sm font-medium",
              tab === "chat" ? "bg-muted text-foreground" : "text-muted-foreground"
            )}
            onClick={() => setTab("chat")}
          >
            Chat with Lyncr
          </button>
          <button
            type="button"
            className={cn(
              "rounded-t-lg px-3 py-2 text-sm font-medium",
              tab === "report" ? "bg-muted text-foreground" : "text-muted-foreground"
            )}
            onClick={() => setTab("report")}
          >
            Report a problem
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "chat" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Start a conversation. Replies show here and on the full Help page.
              </p>
              <Label htmlFor="owner-help-chat" className="sr-only">
                Message to Lyncr Support
              </Label>
              <Textarea
                id="owner-help-chat"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="What do you need help with?"
                rows={4}
                maxLength={4000}
                className="min-h-[96px] resize-y"
              />
              <Button type="button" className="w-full" disabled={sendingChat} onClick={() => void sendChat()}>
                <Send className="mr-2 h-4 w-4" aria-hidden />
                {sendingChat ? "Sending…" : "Send message"}
              </Button>
              <Link
                href="/dashboard/help#support-chat"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                Open full Help chat
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Tell us what went wrong. We include this page name automatically.
              </p>
              <Label htmlFor="owner-help-report" className="sr-only">
                Problem details
              </Label>
              <Textarea
                id="owner-help-report"
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder="What happened? What did you expect?"
                rows={5}
                maxLength={8000}
                className="min-h-[120px] resize-y"
              />
              <p className="text-[11px] text-muted-foreground">Page: {pathname}</p>
              <Button type="button" className="w-full" disabled={sendingReport} onClick={() => void sendReport()}>
                {sendingReport ? "Sending…" : "Send report"}
              </Button>
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-border/70 bg-secondary/15 px-4 py-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Evenings and weekends we still see messages. Replies usually come the next business morning. A person
            sends every reply — nothing auto-replies to your customers.
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
