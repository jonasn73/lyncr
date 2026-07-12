"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useToast } from "@/hooks/use-toast"
import type { RoutingStrategy } from "@/lib/types"
import { DashboardRoutingWithSheets } from "@/components/dashboard-routing-with-sheets"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import { fallbackOptions } from "@/components/dashboard-routing-fallback-options"
import {
  businessNumbersMatch,
  formatPhoneDisplay,
  isDashboardVisibleLineStatus,
  snapDashboardRingTimeoutSec,
  type Contact,
  type DashboardBusinessNumber,
  type FallbackOption,
} from "@/lib/dashboard-routing-utils"
import { useWorkspacePhoneLines } from "@/lib/hooks/use-workspace-phone-lines"
import { primaryPhoneLineForOrganization } from "@/lib/workspace-phone-lines"

export function DashboardPage() {
  const { toast } = useToast()
  const bootstrap = useDashboardBootstrapEffective()
  const {
    activeLine,
    setActiveLine,
    businessNumbers,
    businessNumbersLoading,
    activeOrganizationId,
  } = useDashboardWorkspace()
  const { routingBootstrapPromise } = useDashboardStream()
  const routedNumbers = useWorkspacePhoneLines()
  const routingLine =
    activeLine && routedNumbers.some((b) => businessNumbersMatch(b.number, activeLine))
      ? activeLine
      : primaryPhoneLineForOrganization(routedNumbers, activeOrganizationId, activeLine)

  const receptionistsUrl = useCallback(() => {
    const base = "/api/receptionists"
    if (activeOrganizationId && !activeOrganizationId.startsWith("legacy-")) {
      return `${base}?organization_id=${encodeURIComponent(activeOrganizationId)}`
    }
    return base
  }, [activeOrganizationId])

  const [mainLinePhone, setMainLinePhone] = useState<string | null>(
    () => bootstrap?.routing.ownerPhone ?? null
  )
  const [receptionists, setReceptionists] = useState<Contact[]>(
    () => bootstrap?.routing.receptionists ?? []
  )
  const [selectedReceptionistId, setSelectedReceptionistId] = useState<string | null>(() => {
    if (!bootstrap) return null
    const recId = bootstrap.routing.routing.selected_receptionist_id
    const recs = bootstrap.routing.receptionists
    return recId && recs.some((r) => r.id === recId) ? recId : recs[0]?.id ?? null
  })
  const [fallback, setFallback] = useState<FallbackOption>(
    () => bootstrap?.routing.routing.fallback_type || "owner"
  )
  const [aiRingOwnerFirst, setAiRingOwnerFirst] = useState(
    () => bootstrap?.routing.routing.ai_ring_owner_first ?? false
  )
  const [ringTimeoutSec, setRingTimeoutSec] = useState(() =>
    snapDashboardRingTimeoutSec(bootstrap?.routing.routing.ring_timeout_seconds ?? 30)
  )
  const [routingStrategy, setRoutingStrategy] = useState<RoutingStrategy>(
    () => bootstrap?.routing.routing.routing_strategy ?? "private_only"
  )
  const [allowLyncrNetworkFallback, setAllowLyncrNetworkFallback] = useState(
    () => bootstrap?.routing.routing.allow_lyncr_network_fallback ?? false
  )
  const [inboundCallerGreetingEnabled, setInboundCallerGreetingEnabled] = useState(
    () => bootstrap?.routing.routing.inbound_caller_greeting_enabled !== false
  )

  const [hasTelnyxAiAssistant, setHasTelnyxAiAssistant] = useState(false)
  const [routingLineDetailLoading, setRoutingLineDetailLoading] = useState(false)
  const routingFetchSeqRef = useRef(0)
  const skipNextRoutingFetchRef = useRef(Boolean(bootstrap || routingBootstrapPromise))

  const [sessionFetchDone, setSessionFetchDone] = useState(() => bootstrap != null)
  const [receptionistsFetchDone, setReceptionistsFetchDone] = useState(() => bootstrap != null)
  const [numbersRoutingFetchDone, setNumbersRoutingFetchDone] = useState(() => bootstrap != null)
  const quickSetupDecided =
    sessionFetchDone && receptionistsFetchDone && numbersRoutingFetchDone

  const callFlowUiReady =
    routedNumbers.length > 0 || bootstrap != null || !businessNumbersLoading

  const hadBootstrapOnMountRef = useRef(Boolean(bootstrap))
  const showRoutingDetailLoading = routingLineDetailLoading && !hadBootstrapOnMountRef.current
  const bootstrapHydratedRef = useRef(bootstrap != null)
  const prevActiveLineForRoutingRef = useRef<string | null>(activeLine)
  const prevOrganizationForRoutingRef = useRef<string | null>(activeOrganizationId)

  useEffect(() => {
    if (prevOrganizationForRoutingRef.current === activeOrganizationId) return
    prevOrganizationForRoutingRef.current = activeOrganizationId

    const nextLine = primaryPhoneLineForOrganization(routedNumbers, activeOrganizationId, activeLine)
    if (nextLine && !businessNumbersMatch(activeLine, nextLine)) {
      prevActiveLineForRoutingRef.current = null
      skipNextRoutingFetchRef.current = false
      setActiveLine(nextLine)
    } else if (!nextLine && activeLine) {
      setActiveLine(null)
    }

    void fetch(receptionistsUrl(), { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((data) => {
        if (!Array.isArray(data.data)) return
        const mapped = data.data.map((r: Record<string, string>) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          initials: r.initials || r.name?.slice(0, 2)?.toUpperCase() || "??",
          color: r.color || "bg-primary",
        }))
        setReceptionists(mapped)
        setSelectedReceptionistId((prev) =>
          prev && mapped.some((r: Contact) => r.id === prev) ? prev : mapped[0]?.id ?? null
        )
      })
      .catch(() => {})
  }, [activeOrganizationId, activeLine, routedNumbers, receptionistsUrl, setActiveLine])

  useEffect(() => {
    if (!bootstrap || bootstrapHydratedRef.current) return
    bootstrapHydratedRef.current = true
    setMainLinePhone(bootstrap.routing.ownerPhone ?? null)
    setReceptionists(bootstrap.routing.receptionists)
    const recId = bootstrap.routing.routing.selected_receptionist_id
    setSelectedReceptionistId(
      recId && bootstrap.routing.receptionists.some((r) => r.id === recId)
        ? recId
        : bootstrap.routing.receptionists[0]?.id ?? null
    )
    setFallback(bootstrap.routing.routing.fallback_type || "owner")
    setAiRingOwnerFirst(bootstrap.routing.routing.ai_ring_owner_first ?? false)
    setRingTimeoutSec(snapDashboardRingTimeoutSec(bootstrap.routing.routing.ring_timeout_seconds ?? 30))
    setRoutingStrategy(bootstrap.routing.routing.routing_strategy ?? "private_only")
    setAllowLyncrNetworkFallback(bootstrap.routing.routing.allow_lyncr_network_fallback ?? false)
    setInboundCallerGreetingEnabled(bootstrap.routing.routing.inbound_caller_greeting_enabled !== false)
    if (bootstrap.routing.primaryLineNumber && !activeLine) {
      const inWorkspace = routedNumbers.some((b) =>
        businessNumbersMatch(b.number, bootstrap.routing.primaryLineNumber)
      )
      if (inWorkspace) setActiveLine(bootstrap.routing.primaryLineNumber)
      else if (routedNumbers[0]) setActiveLine(routedNumbers[0].number)
    }
    setSessionFetchDone(true)
    setReceptionistsFetchDone(true)
    setNumbersRoutingFetchDone(true)
  }, [bootstrap, activeLine, routedNumbers, setActiveLine])

  // Platform-admin inbound override for the active line only (scoped per workspace / DID — not global).
  const adminRoutingOverridePhone = useMemo(() => {
    if (!routingLine) return null
    const row = routedNumbers.find((b) => businessNumbersMatch(b.number, routingLine))
    const raw = row?.admin_routing_override_phone?.trim()
    return raw || null
  }, [routedNumbers, routingLine])

  useEffect(() => {
    if (bootstrap || !routingBootstrapPromise) return
    let cancelled = false
    void (async () => {
      try {
        const data = await Promise.resolve(routingBootstrapPromise)
        if (cancelled) return
        if (data.ownerPhone) setMainLinePhone(data.ownerPhone)
        setReceptionists(data.receptionists)
        const recId = data.routing.selected_receptionist_id
        setSelectedReceptionistId(
          recId && data.receptionists.some((r) => r.id === recId) ? recId : data.receptionists[0]?.id ?? null
        )
        setFallback(data.routing.fallback_type || "owner")
        setAiRingOwnerFirst(data.routing.ai_ring_owner_first)
        setRingTimeoutSec(snapDashboardRingTimeoutSec(data.routing.ring_timeout_seconds))
        setRoutingStrategy(data.routing.routing_strategy)
        setAllowLyncrNetworkFallback(data.routing.allow_lyncr_network_fallback)
        setInboundCallerGreetingEnabled(data.routing.inbound_caller_greeting_enabled !== false)
        if (data.primaryLineNumber && !activeLine) {
          setActiveLine(data.primaryLineNumber)
        }
        setSessionFetchDone(true)
        setReceptionistsFetchDone(true)
        setRoutingLineDetailLoading(false)
      } catch {
        if (!cancelled) {
          setSessionFetchDone(true)
          setReceptionistsFetchDone(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootstrap, routingBootstrapPromise, activeLine, setActiveLine])

  useEffect(() => {
    if (bootstrap || routingBootstrapPromise) return
    let cancelled = false
    void Promise.all([
      fetch("/api/auth/session", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data?.data?.user?.phone) setMainLinePhone(data.data.user.phone)
        })
        .catch(() => {}),
      fetch(receptionistsUrl(), { credentials: "include" })
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then((data) => {
          if (cancelled || !Array.isArray(data.data)) return
          const mapped = data.data.map((r: Record<string, string>) => ({
            id: r.id,
            name: r.name,
            phone: r.phone,
            initials: r.initials || r.name?.slice(0, 2)?.toUpperCase() || "??",
            color: r.color || "bg-primary",
          }))
          setReceptionists(mapped)
          setSelectedReceptionistId((prev) =>
            prev && mapped.some((r: Contact) => r.id === prev) ? prev : mapped[0]?.id ?? null
          )
        })
        .catch(() => {}),
    ]).finally(() => {
      if (!cancelled) {
        setSessionFetchDone(true)
        setReceptionistsFetchDone(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [bootstrap, receptionistsUrl, routingBootstrapPromise])

  useEffect(() => {
    if (bootstrap) return
    if (!businessNumbersLoading || businessNumbers.length > 0) {
      setNumbersRoutingFetchDone(true)
    }
  }, [bootstrap, businessNumbersLoading, businessNumbers.length])

  useEffect(() => {
    let cancelled = false
    fetch("/api/ai-assistant", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((aiData) => {
        if (!cancelled && aiData?.hasAssistant) setHasTelnyxAiAssistant(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // After numbers load or you tap a different line, pull effective routing (per-number row merged with account default).
  useEffect(() => {
    if (!numbersRoutingFetchDone) return
    const prevLine = prevActiveLineForRoutingRef.current
    prevActiveLineForRoutingRef.current = activeLine

    if (skipNextRoutingFetchRef.current) {
      skipNextRoutingFetchRef.current = false
      return
    }

    // Bootstrap already includes routing — skip duplicate fetch unless workspace or line changed.
    if (
      bootstrap &&
      prevOrganizationForRoutingRef.current === activeOrganizationId &&
      (!prevLine || prevLine === activeLine)
    ) {
      return
    }

    const seq = ++routingFetchSeqRef.current
    setRoutingLineDetailLoading(true)
    let cancelled = false
    const num = activeLine
    const routingUrl = num ? `/api/routing?number=${encodeURIComponent(num)}` : "/api/routing"
    fetch(routingUrl, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((rData) => {
        if (cancelled || seq !== routingFetchSeqRef.current) return
        if (rData?.config) {
          setSelectedReceptionistId(rData.config.selected_receptionist_id || null)
          setFallback(rData.config.fallback_type || "owner")
          setAiRingOwnerFirst(Boolean(rData.config.ai_ring_owner_first))
          const rt = rData.config.ring_timeout_seconds
          if (typeof rt === "number" && Number.isFinite(rt)) {
            setRingTimeoutSec(snapDashboardRingTimeoutSec(rt))
          }
          // Hybrid-network fields read defensively (default to private_only on un-migrated rows).
          const strat = rData.config.routing_strategy
          if (strat === "private_only" || strat === "lyncr_only" || strat === "hybrid_fallback") {
            setRoutingStrategy(strat)
          } else {
            setRoutingStrategy("private_only")
          }
          setAllowLyncrNetworkFallback(Boolean(rData.config.allow_lyncr_network_fallback))
          if (rData.config.inbound_caller_greeting_enabled !== undefined) {
            setInboundCallerGreetingEnabled(rData.config.inbound_caller_greeting_enabled !== false)
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled || seq !== routingFetchSeqRef.current) return
        setRoutingLineDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [numbersRoutingFetchDone, activeLine, activeOrganizationId, bootstrap])

  // If the selected line disappears (released number), snap back to the first remaining line.
  useEffect(() => {
    if (routedNumbers.length === 0) return
    if (!activeLine || !routedNumbers.some((b) => businessNumbersMatch(b.number, activeLine))) {
      setActiveLine(routedNumbers[0].number)
    }
  }, [routedNumbers, activeLine, setActiveLine])

  const ownerPhoneDisplay = formatPhoneDisplay(mainLinePhone)
  const selectedReceptionist = receptionists.find((c) => c.id === selectedReceptionistId) || null
  const isRoutingToOwner = !selectedReceptionist
  const hasBusinessNumbers = routedNumbers.length > 0
  const hasReceptionists = receptionists.length > 0
  const isSetupComplete = hasBusinessNumbers && (hasReceptionists || Boolean(mainLinePhone))
  const activeFallbackMeta = fallbackOptions.find((o) => o.id === fallback)

  // Save routing for the line shown in the UI (`routingBusinessNumber`), or the account default when you have no numbers yet.
  // When fallback_type is "ai", the API auto-provisions voice AI and returns voiceAi.
  // With **two or more** business lines, never send `business_number: null` for per-line fields — that only updated the
  // account default row and left the tapped line’s `routing_config` unchanged (calls still rang the wrong person).
  const saveRouting = useCallback(
    (updates: Record<string, unknown>, opts?: { quiet?: boolean }): Promise<void> => {
    const active = businessNumbers.filter((b) => isDashboardVisibleLineStatus(b.status))
    const lineE164 =
      (activeLine && activeLine.trim()) ||
      (active.length === 1 ? active[0]?.number?.trim() || null : null)
    const touchesPerLine =
      updates.selected_receptionist_id !== undefined ||
      updates.fallback_type !== undefined ||
      updates.ai_greeting !== undefined ||
      updates.ring_timeout_seconds !== undefined ||
      updates.inbound_caller_greeting_enabled !== undefined
    if (active.length >= 2 && touchesPerLine && !lineE164) {
      if (!opts?.quiet) {
        toast({
          title: "Pick a business line first",
          description: "Tap the number card for the line you want (green outline), then save again.",
          variant: "destructive",
        })
      }
      return Promise.reject(new Error("SIGO_NO_ROUTING_LINE"))
    }

    return fetch("/api/routing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...updates, business_number: lineE164 || null }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          config?: { fallback_type?: string; ai_ring_owner_first?: boolean }
          voiceAi?: { linked?: boolean; provisioned?: boolean; error?: string }
        }
        if (!res.ok) {
          if (!opts?.quiet) {
            toast({
              title: "Could not save routing",
              description: String(data.error || res.statusText || "Try again."),
              variant: "destructive",
            })
          }
          const refetchNum = lineE164 || activeLine
          const routingUrl = refetchNum
            ? `/api/routing?number=${encodeURIComponent(refetchNum)}`
            : "/api/routing"
          void fetch(routingUrl, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((rData) => {
              if (rData?.config?.fallback_type) setFallback(rData.config.fallback_type || "owner")
              if (rData?.config?.ai_ring_owner_first !== undefined) {
                setAiRingOwnerFirst(Boolean(rData.config.ai_ring_owner_first))
              }
            })
          return
        }
        if (data.config?.ai_ring_owner_first !== undefined) {
          setAiRingOwnerFirst(Boolean(data.config.ai_ring_owner_first))
        }
        if (data.voiceAi?.linked) {
          setHasTelnyxAiAssistant(true)
        }
        if (data.voiceAi?.error) {
          toast({
            title: "Voice AI could not be created",
            description: String(data.voiceAi.error),
            variant: "destructive",
          })
        }
        if (!opts?.quiet) {
          if (data.voiceAi?.error) {
            /* destructive toast already shown */
          } else if (updates.fallback_type === "ai" && data.voiceAi?.provisioned) {
            toast({
              title: "AI receptionist ready",
              description: "Your voice assistant was created automatically. Tune the script below anytime.",
            })
          } else if (updates.fallback_type === "ai" && data.voiceAi?.linked) {
            toast({
              title: "AI fallback saved",
              description:
                "Your assistant is linked. Use “Ring my phone first” in Fallback Settings if you want your cell to ring before Voice AI.",
            })
          } else {
            toast({
              title: "Routing updated",
              description:
                businessNumbers.length > 1
                  ? `Line ${formatPhoneDisplay(lineE164 || activeLine)} will use this ring target and fallback.`
                  : "Incoming calls will follow your new routing rule.",
            })
          }
        }
        window.dispatchEvent(new Event("zing-business-numbers-changed"))
        window.dispatchEvent(new Event("lyncr-routing-config-changed"))
      })
      .catch(() => {
        if (!opts?.quiet) {
          toast({
            title: "Network error",
            description: "Could not reach the server. Check your connection and try again.",
            variant: "destructive",
          })
        }
      })
  },
    [businessNumbers, activeLine, toast]
  )

  const selectReceptionist = useCallback(
    (id: string) => {
      const active = businessNumbers.filter((b) => isDashboardVisibleLineStatus(b.status))
      if (active.length >= 2 && !activeLine?.trim()) {
        toast({
          title: "Tap a business number first",
          description: "With two lines, tap the green number card for the line Sarah should answer, then tap Sarah again.",
          variant: "destructive",
        })
        return
      }
      const prev = selectedReceptionistId
      setSelectedReceptionistId(id)
      void saveRouting({ selected_receptionist_id: id }).catch((e) => {
        if (e instanceof Error && e.message === "SIGO_NO_ROUTING_LINE") setSelectedReceptionistId(prev)
      })
    },
    [businessNumbers, activeLine, toast, saveRouting, selectedReceptionistId]
  )

  const clearReceptionist = useCallback(() => {
    const active = businessNumbers.filter((b) => isDashboardVisibleLineStatus(b.status))
    if (active.length >= 2 && !activeLine?.trim()) {
      toast({
        title: "Tap a business number first",
        description: "Tap the line you want to route to your phone, then try again.",
        variant: "destructive",
      })
      return
    }
    const prev = selectedReceptionistId
    setSelectedReceptionistId(null)
    void saveRouting({ selected_receptionist_id: null }).catch((e) => {
      if (e instanceof Error && e.message === "SIGO_NO_ROUTING_LINE") setSelectedReceptionistId(prev)
    })
  }, [businessNumbers, activeLine, toast, saveRouting, selectedReceptionistId])

  return (
    // Full-width shell so the sticky tracking line can span the main column; max-w lives under the bar.
    <div className="flex w-full flex-col gap-10 sm:gap-14">
      <DashboardRoutingWithSheets
        quickSetupDecided={quickSetupDecided}
        callFlowUiReady={callFlowUiReady}
        isSetupComplete={isSetupComplete}
        hasBusinessNumbers={hasBusinessNumbers}
        hasReceptionists={hasReceptionists}
        businessNumbers={routedNumbers}
        routingBusinessNumber={routingLine}
        setRoutingBusinessNumber={setActiveLine}
        routingLineDetailLoading={showRoutingDetailLoading}
        isRoutingToOwner={isRoutingToOwner}
        selectedReceptionist={selectedReceptionist}
        ownerPhoneDisplay={ownerPhoneDisplay}
        ringTimeoutSec={ringTimeoutSec}
        activeFallbackLabel={activeFallbackMeta?.label ?? "Backup"}
        routingStrategy={routingStrategy}
        allowLyncrNetworkFallback={allowLyncrNetworkFallback}
        setRoutingStrategy={setRoutingStrategy}
        setAllowLyncrNetworkFallback={setAllowLyncrNetworkFallback}
        adminRoutingOverridePhone={adminRoutingOverridePhone}
        receptionists={receptionists}
        selectedReceptionistId={selectedReceptionistId}
        clearReceptionist={clearReceptionist}
        selectReceptionist={selectReceptionist}
        setRingTimeoutSec={setRingTimeoutSec}
        inboundCallerGreetingEnabled={inboundCallerGreetingEnabled}
        setInboundCallerGreetingEnabled={setInboundCallerGreetingEnabled}
        saveRouting={saveRouting}
        fallback={fallback}
        setFallback={setFallback}
        aiRingOwnerFirst={aiRingOwnerFirst}
        setAiRingOwnerFirst={setAiRingOwnerFirst}
        hasTelnyxAiAssistant={hasTelnyxAiAssistant}
        setHasTelnyxAiAssistant={setHasTelnyxAiAssistant}
        organizationId={activeOrganizationId}
      />
    </div>
  )
}
