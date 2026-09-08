"use client"

// Admin Home — a real cross-cutting overview, not another Finance page. One glance
// answers "is anything broken, does anything need me right now" across every admin
// area (finance, businesses, support, industries, audit, infra), each card linking to
// its full page. Finance itself now lives at /admin/finance — see that page for the
// full revenue chart, per-business balances, and transaction ledger this page used to
// carry directly.

import { useEffect, useState } from "react"
import Link from "next/link"
import { Database, Phone as PhoneIcon, ShieldAlert, RefreshCw, Building2, MessageSquareWarning } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useLyncrAdminDashboardData } from "@/hooks/use-lyncr-admin-dashboard"
import { useAdminIndustriesOverview } from "@/hooks/use-admin-industries-overview"
import { useAdminAuditEvents } from "@/hooks/use-admin-audit-events"
import { useAdminInfraCost } from "@/hooks/use-admin-infra-cost"
import { CallHealthBoard } from "@/components/admin/call-health-board"
import { HealthDot } from "@/components/admin/shared/health-dot"
import { HeroStat } from "@/components/admin/shared/stat-tile"
import { GaugeBar } from "@/components/admin/shared/gauge-bar"
import { AccountStatusBadge, isShopOwnerRow } from "@/components/lyncr-admin-dashboard"

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/** One clickable overview card — every card here jumps to its own full page. */
function OverviewCard({
  href,
  title,
  children,
}: {
  href: string
  title: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-border bg-card/40 p-4 transition-colors hover:border-operator/40 hover:bg-card/60"
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </Link>
  )
}

/** Unread chat/email/open-feedback counts — same feed the header bell already polls. */
function useSupportPulse() {
  const [counts, setCounts] = useState<{ chat: number; email: number; feedback: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch("/api/admin/notification-feed", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { items?: { kind: string }[] } } | null) => {
        if (cancelled) return
        const items = json?.data?.items ?? []
        setCounts({
          chat: items.filter((i) => i.kind === "chat").length,
          email: items.filter((i) => i.kind === "email").length,
          feedback: items.filter((i) => i.kind === "feedback").length,
        })
      })
      .catch(() => {
        if (!cancelled) setCounts({ chat: 0, email: 0, feedback: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [])
  return counts
}

export function AdminHomeOverview() {
  const { metrics, users, loading, refreshing, fetchLatestAdminStats } = useLyncrAdminDashboardData()
  const { industries, refetch: refetchIndustries } = useAdminIndustriesOverview()
  const { events, refetch: refetchAudit } = useAdminAuditEvents()
  const { data: infra, refetch: refetchInfra } = useAdminInfraCost()
  const support = useSupportPulse()

  const pendingOwners = users.filter((u) => isShopOwnerRow(u) && u.account_status === "pending")
  const platformNetAhead = (metrics?.finance?.platform_net_period_cents ?? 0) >= 0

  const industriesWithAccounts = industries.filter((i) => i.liveAccountCount > 0).length
  const latestEvent = events[0] ?? null

  const refreshAll = () => {
    void fetchLatestAdminStats(true)
    void refetchIndustries()
    void refetchAudit()
    void refetchInfra()
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-3 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Home</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Everything that needs a look, in one place — tap a card for the full picture.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refreshAll} disabled={refreshing}>
          <RefreshCw className={cn("h-4 w-4 sm:mr-2", refreshing && "animate-spin")} aria-hidden />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      <Link href="/admin/finance" className="block">
        <HeroStat
          label={`Platform net · ${metrics?.finance?.business_money_period_label ?? "All time"}`}
          value={metrics?.finance?.platform_net_period_label ?? "—"}
          ahead={platformNetAhead}
          note="Revenue minus estimated phone cost, across every business. Tap for the full Finance page."
        />
      </Link>

      {pendingOwners.length > 0 ? (
        <div id="pending-shops" className="space-y-2 scroll-mt-4">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pending shops — waiting for Approve or Deny
          </p>
          <ul className="divide-y divide-border rounded-xl border border-warning/40 bg-warning/5">
            {pendingOwners.map((row) => (
              <li key={row.user_id}>
                <Link
                  href="/admin/businesses"
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-warning/10"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {row.business_name.trim() || row.email}
                    </span>
                    <span className="block truncate text-2xs text-muted-foreground">{row.email}</span>
                  </span>
                  <AccountStatusBadge status={row.account_status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <OverviewCard href="/admin/businesses" title="Businesses">
          <p className="text-lg font-semibold text-foreground">{metrics?.active_subscriptions ?? "—"}</p>
          <p className="text-2xs text-muted-foreground">paying shops</p>
          <p className="text-2xs text-muted-foreground">
            {metrics?.finance?.total_business_wallet_balance_label ?? "—"} in business wallets
          </p>
        </OverviewCard>

        <OverviewCard href="/admin/support" title="Support">
          {support ? (
            <div className="flex items-center gap-3 text-sm text-foreground">
              <span className="inline-flex items-center gap-1.5">
                <MessageSquareWarning className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {support.chat} chat
              </span>
              <span>{support.email} email</span>
              <span>{support.feedback} feedback</span>
            </div>
          ) : (
            <p className="text-2xs text-muted-foreground">Loading…</p>
          )}
          <p className="text-2xs text-muted-foreground">Open items across every channel.</p>
        </OverviewCard>

        <OverviewCard href="/admin/industries" title="Industries">
          <p className="text-lg font-semibold text-foreground">
            {industriesWithAccounts}/{industries.length || 32}
          </p>
          <p className="text-2xs text-muted-foreground">industries with at least one live account</p>
        </OverviewCard>

        <OverviewCard href="/admin/audit" title="Audit">
          <p className="text-lg font-semibold text-foreground">{events.length}</p>
          <p className="text-2xs text-muted-foreground">
            {latestEvent
              ? `recent events · latest: ${latestEvent.event_type} (${timeAgo(latestEvent.created_at)})`
              : "no recent activity"}
          </p>
        </OverviewCard>

        <OverviewCard href="/admin/infra" title="Infra">
          {infra ? (
            <div className="space-y-2">
              {(
                [
                  { key: "vercel", label: "Vercel", data: infra.vercel },
                  { key: "neon", label: "Neon", data: infra.neon },
                ] as const
              ).map(({ key, label, data }) => {
                const pct = Math.max(0, Math.min(100, data.percent_of_budget))
                const over = data.percent_of_budget >= 100
                const near = data.percent_of_budget >= 80
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between text-2xs text-muted-foreground">
                      <span>{label}</span>
                      <span>{data.configured ? formatUsd(data.spend_cents) : "—"}</span>
                    </div>
                    {data.configured ? (
                      <GaugeBar percent={pct} tone={over ? "destructive" : near ? "warning" : "success"} />
                    ) : null}
                  </div>
                )
              })}
              <div className="flex items-center justify-between text-2xs text-muted-foreground">
                <span>Telnyx</span>
                <span>{infra.telnyx.data_available ? formatUsd(infra.telnyx.balance_cents) : "—"}</span>
              </div>
              {infra.telnyx.data_available ? (
                <GaugeBar
                  percent={Math.max(
                    0,
                    Math.min(
                      100,
                      Math.round(
                        (infra.telnyx.balance_cents / Math.max(infra.telnyx.floor_cents * 2, infra.telnyx.balance_cents, 1)) *
                          100
                      )
                    )
                  )}
                  tone={infra.telnyx.low_balance ? "destructive" : "success"}
                />
              ) : null}
            </div>
          ) : (
            <p className="text-2xs text-muted-foreground">Loading…</p>
          )}
        </OverviewCard>
      </div>

      {metrics ? (
        <div className="rounded-xl border border-border/80 bg-card/40 px-3.5 py-2.5">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">System</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Neon
              <HealthDot status={metrics.health.neon} />
            </span>
            <span className="inline-flex items-center gap-2">
              <PhoneIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Telnyx
              <HealthDot status={metrics.health.telnyx} />
            </span>
            <span className="inline-flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Sentry
              <HealthDot status={metrics.health.sentry} />
            </span>
            <Link
              href="/admin/businesses"
              className="ml-auto inline-flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground"
            >
              <Building2 className="h-3.5 w-3.5" aria-hidden />
              {loading ? "…" : `${users.length} accounts`}
            </Link>
          </div>
        </div>
      ) : null}

      <CallHealthBoard />
    </div>
  )
}
