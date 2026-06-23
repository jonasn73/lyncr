"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useToast } from "@/hooks/use-toast"
import type { RoutingStrategy } from "@/lib/types"
import { DashboardRoutingWithSheets } from "@/components/dashboard-routing-with-sheets"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
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

export function DashboardPage() {
  const { toast } = useToast()
  const {
    activeLine,
    setActiveLine,
    businessNumbers,
    businessNumbersLoading,
    activeOrganizationId,
  } = useDashboardWorkspace()
  const { routingBootstrapPromise } = useDashboardStream()

  const receptionistsUrl = useCallback(() => {
    const base = "/api/receptionists"
    if (activeOrganizationId && !activeOrganizationId.startsWith("legacy-")) {
      return `${base}?organization_id=${encodeURIComponent(activeOrganizationId)}`
    }
    return base
  }, [activeOrganizationId])

  const [mainLinePhone, setMainLinePhone] = useState<string | null>(null)
  const [receptionists, setReceptionists] = useState<Contact[]>([])
  const [selectedReceptionistId, setSelectedReceptionistId] = useState<string | null>(null)
  const [fallback, setFallback] = useState<FallbackOption>("owner")
  /** AI fallback + no receptionist: ring owner cell before Voice AI (see Fallback Settings). */
  const [aiRingOwnerFirst, setAiRingOwnerFirst] = useState(false)
  /** Ring duration for the first leg before no-answer fallback (from GET /api/routing). */
  const [ringTimeoutSec, setRingTimeoutSec] = useState(30)
  /** Hybrid-network routing (migrations 048/049) — drives the Call flow "Lyncr Network Pool" step. */
  const [routingStrategy, setRoutingStrategy] = useState<RoutingStrategy>("private_only")
  const [allowLyncrNetworkFallback, setAllowLyncrNetworkFallback] = useState(false)

  // AI assistant state
  const [hasTelnyxAiAssistant, setHasTelnyxAiAssistant] = useState(false)
  // activeLine + businessNumbers live in DashboardWorkspaceProvider (line picker + cross-tab filters).
  // True while GET /api/routing for the tapped line is in flight (avoids showing the previous line’s target).
  const [routingLineDetailLoading, setRoutingLineDetailLoading] = useState(false)
  const routingFetchSeqRef = useRef(0)
  const skipNextRoutingFetchRef = useRef(Boolean(routingBootstrapPromise))

  // Wait until these complete before showing “Quick setup” — otherwise empty initial state looks
  // like an incomplete setup and the banner flashes away when APIs return (confusing on refresh).
  const [sessionFetchDone, setSessionFetchDone] = useState(false)
  const [receptionistsFetchDone, setReceptionistsFetchDone] = useState(false)
  const [numbersRoutingFetchDone, setNumbersRoutingFetchDone] = useState(false)
  const quickSetupDecided =
    sessionFetchDone && receptionistsFetchDone && numbersRoutingFetchDone

  /** Call-flow cards render once phone lines finish streaming — not blocked on team/routing fetches. */
  const callFlowUiReady = !businessNumbersLoading

  // Platform-admin inbound override for the active line only (scoped per workspace / DID — not global).
  const adminRoutingOverridePhone = useMemo(() => {
    if (!activeLine) return null
    const row = businessNumbers.find((b) => businessNumbersMatch(b.number, activeLine))
    const raw = row?.admin_routing_override_phone?.trim()
    return raw || null
  }, [businessNumbers, activeLine])

  // Stream routing bootstrap from the server on hard refresh (parallel with phone lines).
  useEffect(() => {
    if (!routingBootstrapPromise) return
    let cancelled = false
    void routingBootstrapPromise
      .then((data) => {
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
        if (data.primaryLineNumber) {
          setActiveLine((prev) => prev ?? data.primaryLineNumber)
        }
        setSessionFetchDone(true)
        setReceptionistsFetchDone(true)
        setRoutingLineDetailLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setSessionFetchDone(true)
          setReceptionistsFetchDone(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [routingBootstrapPromise, setActiveLine])

  // Session + receptionists load in parallel when server stream is unavailable (client tab nav).
  useEffect(() => {
    if (routingBootstrapPromise) return
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
  }, [receptionistsUrl, routingBootstrapPromise])

  // Phone lines hydrate via SWR or server stream (`DashboardBusinessNumbersSync` in the shell).
  useEffect(() => {
    if (!businessNumbersLoading || businessNumbers.length > 0) {
      setNumbersRoutingFetchDone(true)
    }
  }, [businessNumbersLoading, businessNumbers.length])

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
    if (skipNextRoutingFetchRef.current) {
      skipNextRoutingFetchRef.current = false
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
  }, [numbersRoutingFetchDone, activeLine, routingBootstrapPromise])

  // If the selected line disappears (released number), snap back to the first remaining line.
  useEffect(() => {
    if (businessNumbers.length === 0) return
    if (!activeLine || !businessNumbers.some((b) => businessNumbersMatch(b.number, activeLine))) {
      setActiveLine(businessNumbers[0].number)
    }
  }, [businessNumbers, activeLine, setActiveLine])

  const ownerPhoneDisplay = formatPhoneDisplay(mainLinePhone)
  const selectedReceptionist = receptionists.find((c) => c.id === selectedReceptionistId) || null
  const isRoutingToOwner = !selectedReceptionist
  const hasBusinessNumbers = businessNumbers.length > 0
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
      updates.ring_timeout_seconds !== undefined
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 sm:gap-14">
      <DashboardRoutingWithSheets
        quickSetupDecided={quickSetupDecided}
        callFlowUiReady={callFlowUiReady}
        isSetupComplete={isSetupComplete}
        hasBusinessNumbers={hasBusinessNumbers}
        hasReceptionists={hasReceptionists}
        businessNumbers={businessNumbers}
        routingBusinessNumber={activeLine}
        setRoutingBusinessNumber={setActiveLine}
        routingLineDetailLoading={routingLineDetailLoading}
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
        saveRouting={saveRouting}
        fallback={fallback}
        setFallback={setFallback}
        aiRingOwnerFirst={aiRingOwnerFirst}
        setAiRingOwnerFirst={setAiRingOwnerFirst}
        hasTelnyxAiAssistant={hasTelnyxAiAssistant}
        setHasTelnyxAiAssistant={setHasTelnyxAiAssistant}
      />
    </div>
  )
}
