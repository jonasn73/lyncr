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
  WorkspaceDisclosureRow,
  workspaceFieldClass,
} from "@/components/dashboard-workspace-ui"
import { SettingsMenuRow } from "@/components/dashboard/settings-menu-row"
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
    <WorkspacePage className="gap-8 pb-8">
      <WorkspacePageHeader eyebrow="Account" title="Settings" />

      <div className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 sm:px-5">
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

      <section className="space-y-2">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Workspace</p>
        <div className="flex flex-col gap-2">
          <SettingsMenuRow
            icon={<Building2 className="h-5 w-5 text-primary" aria-hidden />}
            title="Business profile"
            subtitle="Business name, lead-alert SMS number, and operator dispatch notifications."
            onClick={modals.openBusinessProfile}
          />
          <SettingsMenuRow
            icon={<CreditCard className="h-5 w-5 text-primary" aria-hidden />}
            title="Billing & subscription"
            subtitle={
              profile.subscriptionActive
                ? "View your plan, renewal date, and carrier credit on the Pay tab."
                : "Activate your line and manage plans from the Pay tab."
            }
            onClick={modals.openBilling}
          />
          <SettingsMenuRow
            icon={<Zap className="h-5 w-5 text-violet-300" aria-hidden />}
            title="SMS automation engine"
            subtitle="Booking confirmations, en-route texts, and post-job review templates with merge tags."
            onClick={modals.openSmsAutomation}
          />
          <SettingsMenuRow
            icon={<ShieldCheck className="h-5 w-5 text-violet-300" aria-hidden />}
            title="Carrier 10DLC registration"
            subtitle="One-time US carrier compliance so lead-alert and customer SMS can deliver."
            badge={carrierRegistrationPending ? "Pending" : undefined}
            onClick={modals.openCarrierRegistration}
          />
          <SettingsMenuRow
            icon={<Network className="h-5 w-5 text-violet-300" aria-hidden />}
            title="Call routing strategy"
            subtitle="Private team, Lyncr operator pool, or hybrid fallback per business line."
            onClick={modals.openRoutingStrategy}
          />
        </div>
      </section>

      <section className="space-y-3">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">System</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <ToggleRow label="Push" icon={Bell} checked={pushEnabled} onChange={setPushEnabled} />
          <ToggleRow label="SMS" icon={MessageSquare} checked={smsEnabled} onChange={setSmsEnabled} />
          <ToggleRow
            label="Whisper"
            icon={Volume2}
            checked={whisperEnabled}
            disabled={whisperSaving}
            onChange={(v) => onSaveWhisper(v)}
          />
        </div>
      </section>

      <section className="space-y-2">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Operations</p>
        <div className="flex flex-col gap-2">
          <WorkspaceDisclosureRow
            icon={<Clock className="h-5 w-5" />}
            label="Business hours"
            onClick={() => openHours(HOURS_SHEET_KEY)}
          />
          <WorkspaceDisclosureRow
            icon={<Shield className="h-5 w-5" />}
            label="Privacy"
            onClick={() => {
              const url = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL || "/privacy"
              window.open(url, process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL ? "_blank" : "_self")
            }}
          />
          <WorkspaceDisclosureRow
            icon={<LogOut className="h-5 w-5" />}
            label={signingOut ? "Signing out…" : "Sign out"}
            destructive
            onClick={onSignOut}
          />
        </div>
      </section>
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
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-4">
      <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        {label}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}
