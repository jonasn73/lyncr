"use client"

import { memo, useEffect, useState } from "react"
import {
  Bell,
  Building2,
  Clock,
  CreditCard,
  Loader2,
  LogOut,
  MessageSquare,
  Network,
  Shield,
  ShieldCheck,
  Volume2,
  Zap,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import {
  DrawerStepHeader,
  DrawerScrollBody,
} from "@/components/dashboard-routing-drawer-shared"
import { useToast } from "@/hooks/use-toast"
import { signOutAndGoToLogin } from "@/lib/client-auth"
import {
  WorkspacePage,
  WorkspacePageHeader,
  workspaceFieldClass,
} from "@/components/dashboard-workspace-ui"
import { SettingsMenuRow, SettingsGroupedList } from "@/components/dashboard/settings-menu-row"
import { useSettingsModalActions } from "@/components/dashboard/settings-modals-host"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { fetchOnboardingProfile } from "@/lib/onboarding-profile-client"
import { isVerifiedActiveSubscription } from "@/lib/onboarding-subscription-status"
import { readActiveOrganizationId } from "@/lib/workspace-organizations"
import {
  WorkspaceRightSheetGate,
  useWorkspaceRightSheet,
} from "@/components/workspace-right-sheet-gate"
import { PlatformNotificationSettings } from "@/components/admin/platform-notification-settings"

type SettingsProfileSummary = {
  name: string
  email: string
  subscriptionActive: boolean
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
type DayHours = { open: string; close: string; enabled: boolean }
const DEFAULT_HOURS: Record<(typeof WEEKDAYS)[number], DayHours> = {
  Mon: { open: "09:00", close: "17:00", enabled: true },
  Tue: { open: "09:00", close: "17:00", enabled: true },
  Wed: { open: "09:00", close: "17:00", enabled: true },
  Thu: { open: "09:00", close: "17:00", enabled: true },
  Fri: { open: "09:00", close: "17:00", enabled: true },
  Sat: { open: "10:00", close: "14:00", enabled: false },
  Sun: { open: "10:00", close: "14:00", enabled: false },
}

const HOURS_SHEET_KEY = true as const

function SettingsHoursSheet() {
  const [hours, setHours] = useState(DEFAULT_HOURS)

  return (
    <>
      <DrawerStepHeader step="Schedule" title="Business Hours" subtitle="" />
      <DrawerScrollBody>
        <ul className="flex flex-col gap-2">
          {WEEKDAYS.map((day) => {
            const row = hours[day]
            return (
              <li
                key={day}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5"
              >
                <label className="flex w-12 items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) =>
                      setHours((prev) => ({ ...prev, [day]: { ...prev[day], enabled: e.target.checked } }))
                    }
                  />
                  {day}
                </label>
                <input
                  type="time"
                  disabled={!row.enabled}
                  value={row.open}
                  onChange={(e) =>
                    setHours((prev) => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))
                  }
                  className={workspaceFieldClass + " max-w-[7rem] py-1.5 text-xs disabled:opacity-40"}
                />
                <span className="text-xs text-zinc-600">–</span>
                <input
                  type="time"
                  disabled={!row.enabled}
                  value={row.close}
                  onChange={(e) =>
                    setHours((prev) => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))
                  }
                  className={workspaceFieldClass + " max-w-[7rem] py-1.5 text-xs disabled:opacity-40"}
                />
              </li>
            )
          })}
        </ul>
      </DrawerScrollBody>
    </>
  )
}

const SettingsWorkspaceBody = memo(function SettingsWorkspaceBody({
  profileLoading,
  profile,
  pushEnabled,
  setPushEnabled,
  smsEnabled,
  setSmsEnabled,
  whisperEnabled,
  whisperSaving,
  onSaveWhisper,
  signingOut,
  onSignOut,
  carrierRegistrationPending,
  isPlatformAdmin,
}: {
  profileLoading: boolean
  profile: SettingsProfileSummary
  pushEnabled: boolean
  setPushEnabled: (v: boolean) => void
  smsEnabled: boolean
  setSmsEnabled: (v: boolean) => void
  whisperEnabled: boolean
  whisperSaving: boolean
  onSaveWhisper: (v: boolean) => void
  signingOut: boolean
  onSignOut: () => void
  carrierRegistrationPending: boolean
  isPlatformAdmin: boolean
}) {
  const openHours = useWorkspaceRightSheet<typeof HOURS_SHEET_KEY>()
  const modals = useSettingsModalActions()
  const initials = profile.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <WorkspacePage className="gap-6 pb-10">
      <WorkspacePageHeader eyebrow="Account" title="Settings" />

      <div className="flex items-center gap-4 rounded-xl border border-slate-850/60 bg-slate-900/30 px-4 py-3">
        {profileLoading ? (
          <>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <span className="block h-4 w-36 animate-pulse rounded bg-zinc-800" aria-hidden />
              <span className="block h-3 w-48 animate-pulse rounded bg-zinc-800/80" aria-hidden />
            </div>
          </>
        ) : (
          <>
            <Avatar className="h-12 w-12 shrink-0">
              <AvatarFallback className="bg-primary text-base font-semibold text-primary-foreground">
                {initials || "ME"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">{profile.name || "Account"}</p>
              <p className="truncate text-sm text-zinc-500">{profile.email}</p>
            </div>
          </>
        )}
      </div>

      {isPlatformAdmin ? <PlatformNotificationSettings variant="dashboard" className="rounded-xl" /> : null}

      {/* WORKSPACE — single grouped list */}
      <section className="space-y-2">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Workspace</p>
        <SettingsGroupedList>
          <SettingsMenuRow
            grouped
            icon={<Building2 className="h-5 w-5 text-primary" aria-hidden />}
            title="Business profile"
            subtitle="Name, lead-alert SMS number, operator notifications."
            onClick={modals.openBusinessProfile}
          />
          <SettingsMenuRow
            grouped
            icon={<CreditCard className="h-5 w-5 text-primary" aria-hidden />}
            title="Billing & subscription"
            subtitle={
              profile.subscriptionActive
                ? "Plan, renewal, and carrier credit on Pay."
                : "Activate your line and manage plans on Pay."
            }
            onClick={modals.openBilling}
          />
          <SettingsMenuRow
            grouped
            icon={<Zap className="h-5 w-5 text-violet-300" aria-hidden />}
            title="SMS automation engine"
            subtitle="Confirmations, en-route texts, review templates."
            onClick={modals.openSmsAutomation}
          />
          <SettingsMenuRow
            grouped
            icon={<ShieldCheck className="h-5 w-5 text-violet-300" aria-hidden />}
            title="Carrier 10DLC registration"
            subtitle="US carrier compliance for lead-alert SMS."
            badge={carrierRegistrationPending ? "Pending" : undefined}
            onClick={modals.openCarrierRegistration}
          />
          <SettingsMenuRow
            grouped
            icon={<Network className="h-5 w-5 text-violet-300" aria-hidden />}
            title="Call routing strategy"
            subtitle="Private team, Lyncr pool, or hybrid fallback."
            onClick={modals.openRoutingStrategy}
          />
        </SettingsGroupedList>
      </section>

      {/* SYSTEM — Push / SMS / Whisper in one list */}
      <section className="space-y-2">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">System</p>
        <SettingsGroupedList>
          <ToggleRow label="Push" icon={Bell} checked={pushEnabled} onChange={setPushEnabled} />
          <ToggleRow label="SMS" icon={MessageSquare} checked={smsEnabled} onChange={setSmsEnabled} />
          <ToggleRow
            label="Whisper"
            icon={Volume2}
            checked={whisperEnabled}
            disabled={whisperSaving}
            onChange={(v) => onSaveWhisper(v)}
          />
        </SettingsGroupedList>
      </section>

      {/* OPERATIONS — hours + privacy only; Sign out sits alone below */}
      <section className="space-y-2">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Operations</p>
        <SettingsGroupedList>
          <SettingsMenuRow
            grouped
            icon={<Clock className="h-5 w-5" aria-hidden />}
            title="Business hours"
            onClick={() => openHours(HOURS_SHEET_KEY)}
          />
          <SettingsMenuRow
            grouped
            icon={<Shield className="h-5 w-5" aria-hidden />}
            title="Privacy"
            onClick={() => {
              const url = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL || "/privacy"
              window.open(url, process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL ? "_blank" : "_self")
            }}
          />
        </SettingsGroupedList>
      </section>

      {/* Sign out — unbordered rose action, clear separation from lists */}
      <div className="pt-2">
        <button
          type="button"
          disabled={signingOut}
          onClick={onSignOut}
          className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-rose-400 transition-colors hover:text-rose-300 disabled:opacity-50"
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <LogOut className="h-4 w-4" aria-hidden />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </WorkspacePage>
  )
})

export const SettingsWorkspaceView = memo(function SettingsWorkspaceView() {
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

  const [pushEnabled, setPushEnabled] = useState(true)
  const [smsEnabled, setSmsEnabled] = useState(true)
  const [whisperEnabled, setWhisperEnabled] = useState(
    () => sessionSeed?.inboundReceptionistWhisperEnabled !== false
  )
  const [whisperSaving, setWhisperSaving] = useState(false)

  useEffect(() => {
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
  }, [sessionSeed])

  useEffect(() => {
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
  }, [activeOrganizationId])

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
    <WorkspaceRightSheetGate<typeof HOURS_SHEET_KEY>
      render={() => <SettingsHoursSheet />}
    >
      <SettingsWorkspaceBody
        profileLoading={profileLoading}
        profile={profile}
        pushEnabled={pushEnabled}
        setPushEnabled={setPushEnabled}
        smsEnabled={smsEnabled}
        setSmsEnabled={setSmsEnabled}
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
    </WorkspaceRightSheetGate>
  )
})

function ToggleRow({
  label,
  icon: Icon,
  checked,
  onChange,
  disabled,
}: {
  label: string
  icon: typeof Bell
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  // Inset toggle row for SettingsGroupedList — icon + label left, switch right.
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-900/60 px-4 py-3 last:border-0">
      <span className="flex min-w-0 items-center gap-3 text-sm font-medium text-foreground">
        <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        {label}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}
