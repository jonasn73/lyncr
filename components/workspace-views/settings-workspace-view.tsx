"use client"

import { memo, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Building2,
  CreditCard,
  Banknote,
  Loader2,
  LogOut,
  MessageSquareText,
  Network,
  Package,
  Percent,
  Shield,
  ShieldCheck,
  LifeBuoy,
  Sparkles,
  Users,
  Volume2,
  Zap,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import {
  WorkspacePage,
  WorkspacePageHeader,
} from "@/components/dashboard-workspace-ui"
import { SettingsMenuRow, SettingsGroupedList } from "@/components/dashboard/settings-menu-row"
import { useSettingsModalActions } from "@/components/dashboard/settings-modals-host"
import { SalesTaxSettingsSheet } from "@/components/dashboard/sales-tax-settings-sheet"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { fetchOnboardingProfile } from "@/lib/onboarding-profile-client"
import { isVerifiedActiveSubscription } from "@/lib/onboarding-subscription-status"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import { closeHeaderSettings } from "@/lib/settings-modals-events"
import { PlatformNotificationSettings } from "@/components/admin/platform-notification-settings"
import { openOwnerHelpSheet } from "@/lib/owner-help-events"

type SettingsProfileSummary = {
  name: string
  email: string
  subscriptionActive: boolean
}

const SettingsWorkspaceBody = memo(function SettingsWorkspaceBody({
  profileLoading,
  profile,
  whisperEnabled,
  whisperSaving,
  onSaveWhisper,
  signingOut,
  onSignOut,
  carrierRegistrationPending,
  isPlatformAdmin,
  /** Hide page chrome when rendered inside the header Settings sheet. */
  embedded = false,
}: {
  profileLoading: boolean
  profile: SettingsProfileSummary
  whisperEnabled: boolean
  whisperSaving: boolean
  onSaveWhisper: (v: boolean) => void
  signingOut: boolean
  onSignOut: () => void
  carrierRegistrationPending: boolean
  isPlatformAdmin: boolean
  embedded?: boolean
}) {
  const modals = useSettingsModalActions()
  const router = useRouter()
  const [salesTaxOpen, setSalesTaxOpen] = useState(false)
  const initials = profile.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <WorkspacePage className={cn("gap-6 pb-10", embedded && "gap-4 px-0 pb-4")}>
      {embedded ? null : <WorkspacePageHeader eyebrow="Account" title="Settings" />}

      {/* Full-page Settings only — sheet header already shows email. */}
      {embedded ? null : (
        <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-card/30 px-4 py-3">
          {profileLoading ? (
            <>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <span className="block h-4 w-36 animate-pulse rounded bg-muted" aria-hidden />
                <span className="block h-3 w-48 animate-pulse rounded bg-muted/80" aria-hidden />
              </div>
            </>
          ) : (
            <>
              <Avatar className="h-11 w-11 shrink-0">
                <AvatarFallback className="bg-primary text-base font-semibold text-primary-foreground">
                  {initials || "ME"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground">{profile.name || "Account"}</p>
                <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
              </div>
            </>
          )}
        </div>
      )}

      {isPlatformAdmin ? <PlatformNotificationSettings variant="dashboard" className="rounded-xl" /> : null}

      <section className="space-y-2">
        <p className="px-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Account</p>
        <SettingsGroupedList>
          <SettingsMenuRow
            grouped
            icon={<Building2 className="h-5 w-5 text-primary" aria-hidden />}
            title="Business profile"
            subtitle="Name, SMS alerts, operator notifications"
            onClick={modals.openBusinessProfile}
          />
          <SettingsMenuRow
            grouped
            icon={<CreditCard className="h-5 w-5 text-primary" aria-hidden />}
            title="Billing"
            subtitle={
              profile.subscriptionActive
                ? "Plan, renewal, and carrier credit"
                : "Activate your line on Pay"
            }
            onClick={modals.openBilling}
          />
          <SettingsMenuRow
            grouped
            icon={<Banknote className="h-5 w-5 text-success" aria-hidden />}
            title="Bank account"
            subtitle="Set up or change the bank that receives card money"
            onClick={modals.openGetPaid}
          />
          <SettingsMenuRow
            grouped
            icon={<Percent className="h-5 w-5 text-success" aria-hidden />}
            title="Sales tax default"
            subtitle="Charge opens with tax on (unless you turn this off)"
            onClick={() => setSalesTaxOpen(true)}
          />
        </SettingsGroupedList>
      </section>

      <SalesTaxSettingsSheet open={salesTaxOpen} onOpenChange={setSalesTaxOpen} />

      <section className="space-y-2">
        <p className="px-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Calls & SMS</p>
        <SettingsGroupedList>
          <SettingsMenuRow
            grouped
            icon={<Users className="h-5 w-5 text-operator" aria-hidden />}
            title="Team"
            subtitle="Add people who answer — phone or invite link"
            onClick={() => {
              closeHeaderSettings()
              router.push("/dashboard/team")
            }}
          />
          <SettingsMenuRow
            grouped
            icon={<Network className="h-5 w-5 text-operator" aria-hidden />}
            title="Call routing"
            subtitle="Who answers — team, pool, or hybrid"
            onClick={modals.openRoutingStrategy}
          />
          <SettingsMenuRow
            grouped
            icon={<Zap className="h-5 w-5 text-operator" aria-hidden />}
            title="SMS templates"
            subtitle="Job texts + your reusable quick SMS shortcuts"
            onClick={modals.openSmsAutomation}
          />
          <SettingsMenuRow
            grouped
            icon={<ShieldCheck className="h-5 w-5 text-operator" aria-hidden />}
            title="Carrier registration"
            subtitle="10DLC for US lead-alert SMS"
            badge={carrierRegistrationPending ? "Pending" : undefined}
            onClick={modals.openCarrierRegistration}
          />
          <ToggleRow
            label="Call whisper"
            subtitle="Say the caller’s name before you pick up"
            checked={whisperEnabled}
            disabled={whisperSaving}
            onChange={(v) => onSaveWhisper(v)}
          />
        </SettingsGroupedList>
      </section>

      <section className="space-y-2">
        <p className="px-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">More</p>
        <SettingsGroupedList>
          <SettingsMenuRow
            grouped
            icon={<Package className="h-5 w-5 text-success" aria-hidden />}
            title="Key inventory"
            subtitle="Stock hub and barcode scanner"
            onClick={() => {
              closeHeaderSettings()
              router.push("/dashboard/inventory")
            }}
          />
          <SettingsMenuRow
            grouped
            icon={<LifeBuoy className="h-5 w-5 text-operator" aria-hidden />}
            title="Help"
            subtitle="Chat with Lyncr or report a problem"
            onClick={() => {
              closeHeaderSettings()
              openOwnerHelpSheet("chat")
            }}
          />
          <SettingsMenuRow
            grouped
            icon={<Shield className="h-5 w-5" aria-hidden />}
            title="Privacy"
            onClick={() => {
              closeHeaderSettings()
              const url = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL || "/privacy"
              window.open(url, process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL ? "_blank" : "_self")
            }}
          />
        </SettingsGroupedList>
      </section>

      {/* Sign out — full page only; sheet has its own footer. */}
      {embedded ? null : (
        <div className="pt-2">
          <button
            type="button"
            disabled={signingOut}
            onClick={onSignOut}
            className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-destructive transition-colors hover:text-destructive disabled:opacity-50"
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <LogOut className="h-4 w-4" aria-hidden />
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </WorkspacePage>
  )
})

export const SettingsWorkspaceView = memo(function SettingsWorkspaceView({
  embedded = false,
  isActive = true,
}: {
  /** Compact mode for the header avatar Settings sheet. */
  embedded?: boolean
  /** When false (presence host inactive), skip profile / 10DLC network. */
  isActive?: boolean
}) {
  const { toast } = useToast()
  const sessionSeed = useDashboardSessionOptional()
  const { activeOrganizationId } = useDashboardWorkspace()
  const [profileLoading, setProfileLoading] = useState(() => !sessionSeed)
  const [signingOut, setSigningOut] = useState(false)
  const [carrierRegistrationPending, setCarrierRegistrationPending] = useState(false)

  const [profile, setProfile] = useState<SettingsProfileSummary>(() => ({
    name: sessionSeed?.name ?? "",
    email: sessionSeed?.email ?? "",
    subscriptionActive: false,
  }))

  const [whisperEnabled, setWhisperEnabled] = useState(
    () => sessionSeed?.inboundReceptionistWhisperEnabled !== false
  )
  const [whisperSaving, setWhisperSaving] = useState(false)

  useEffect(() => {
    // Header-embedded sheet always loads; tab pane waits until Settings is active.
    if (!embedded && !isActive) return
    let cancelled = false

    void fetchOnboardingProfile()
      .then(({ profile: ob, carrierLive }) => {
        if (cancelled) return
        setProfile((p) => ({
          ...p,
          subscriptionActive: isVerifiedActiveSubscription(ob, carrierLive),
        }))
      })
      .catch(() => {})

    if (sessionSeed) {
      setProfileLoading(false)
      return () => {
        cancelled = true
      }
    }

    fetch("/api/auth/session", { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const u = data?.data?.user
        if (!u) return
        setProfile((p) => ({
          ...p,
          name: String(u.name ?? ""),
          email: String(u.email ?? ""),
        }))
        setWhisperEnabled(u.inbound_receptionist_whisper_enabled !== false)
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionSeed, isActive, embedded])

  useEffect(() => {
    if (!embedded && !isActive) return
    const orgId = activeOrganizationId ?? readActiveOrganizationId()
    const qs =
      orgId && !orgId.startsWith("legacy-")
        ? `?organization_id=${encodeURIComponent(orgId)}`
        : ""
    fetch(`/api/settings/10dlc${qs}`, { credentials: "include" })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((json) => {
        const pending =
          json?.data?.pending_approval === true || json?.data?.organization_status === "PENDING_APPROVAL"
        setCarrierRegistrationPending(pending)
      })
      .catch(() => setCarrierRegistrationPending(false))
  }, [activeOrganizationId, isActive, embedded])

  async function saveWhisper(next: boolean) {
    setWhisperSaving(true)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ inbound_receptionist_whisper_enabled: next }),
      })
      if (!res.ok) throw new Error("Save failed")
      setWhisperEnabled(next)
      toast({ title: next ? "Whisper on" : "Whisper off" })
    } catch (e) {
      toast({
        title: "Could not update whisper",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      })
    } finally {
      setWhisperSaving(false)
    }
  }

  return (
    <SettingsWorkspaceBody
      embedded={embedded}
      profileLoading={profileLoading}
      profile={profile}
      whisperEnabled={whisperEnabled}
      whisperSaving={whisperSaving}
      onSaveWhisper={(v) => void saveWhisper(v)}
      signingOut={signingOut}
      carrierRegistrationPending={carrierRegistrationPending}
      isPlatformAdmin={sessionSeed?.isPlatformAdmin === true}
      onSignOut={() => {
        setSigningOut(true)
        void signOutAndGoToLogin().finally(() => setSigningOut(false))
      }}
    />
  )
})

function ToggleRow({
  label,
  subtitle,
  checked,
  onChange,
  disabled,
}: {
  label: string
  subtitle?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-0">
      <span className="flex min-w-0 items-center gap-3">
        <Volume2 className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{label}</span>
          {subtitle ? (
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{subtitle}</span>
          ) : null}
        </span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}
