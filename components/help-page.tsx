"use client"

// ============================================
// Help — pricing summary, credits, feedback form
// ============================================

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import type { User } from "@/lib/types"

type SessionUser = User & { operator_access?: boolean }

type BillingSummary = {
  current_plan: string
  credit_balance_cents: number
  credit_balance_label: string
  metered_voice_cents_per_minute: number
  suggested_credit_packs_cents: number[]
  plans: { key: string; monthly_price_label: string; included_minutes_per_month: number }[]
}

export function HelpPage() {
  const { toast } = useToast()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [category, setCategory] = useState<string>("issue")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data?.user) setUser(j.data.user as SessionUser)
      })
      .catch(() => {})
    fetch("/api/billing/summary", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data) setBilling(j.data as BillingSummary)
      })
      .catch(() => {})
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject, body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Could not send", description: j?.error ?? res.statusText, variant: "destructive" })
        return
      }
      toast({ title: "Thanks!", description: "We received your message." })
      setSubject("")
      setBody("")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-6 pb-28">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Help & feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pricing overview, account balance, and a direct line to report issues or suggest features.
        </p>
      </div>

      {billing && (
        <Card className="border-border/80 bg-card/90 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Your plan & balance</CardTitle>
            <CardDescription>Prepaid credits apply to future metered usage (voice minutes, AI, etc.).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Current plan</span>
              <span className="font-medium capitalize text-foreground">{billing.current_plan}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Account balance</span>
              <span className="font-medium text-foreground">{billing.credit_balance_label}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Voice overage (after included minutes)</span>
              <span className="font-medium text-foreground">
                {(billing.metered_voice_cents_per_minute / 100).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                })}
                /min
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Top-ups and subscriptions will connect to checkout in a later release; balances are stored on your account
              today so support can credit you manually if needed.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/80 bg-card/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Plans (reference)</CardTitle>
          <CardDescription>Included minutes are pooled estimates before metered rates apply.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(billing?.plans ?? []).map((p) => (
            <div key={p.key} className="flex justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
              <span className="capitalize text-foreground">{p.key}</span>
              <span className="text-muted-foreground">
                {p.monthly_price_label}/mo · {p.included_minutes_per_month} min incl.
              </span>
            </div>
          ))}
          {!billing && <p className="text-sm text-muted-foreground">Sign in to load pricing.</p>}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/90 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Send a message</CardTitle>
          <CardDescription>Bug reports, billing questions, or feature ideas go to the same queue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="cat">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="cat" className="w-full">
                  <SelectValue placeholder="Pick one" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="issue">Something is broken</SelectItem>
                  <SelectItem value="feature">Feature request</SelectItem>
                  <SelectItem value="billing">Billing or usage</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subj">Subject</Label>
              <Input
                id="subj"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Short summary"
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Details</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What happened, what you expected, and any steps to reproduce."
                rows={5}
                maxLength={8000}
                required
                className="min-h-[120px] resize-y"
              />
            </div>
            <Button type="submit" className="w-full" disabled={sending}>
              {sending ? "Sending…" : "Submit"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {user?.operator_access && (
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/admin" className="font-medium text-primary underline-offset-4 hover:underline">
            Open operator console
          </Link>
        </p>
      )}
    </div>
  )
}
