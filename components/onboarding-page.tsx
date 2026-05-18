"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  getOnboardingOpeningLine,
  isOnboardingTradeCategory,
  ONBOARDING_DEFAULT_VOICEMAIL_GREETING,
  ONBOARDING_FALLBACK_DEFAULT,
  ONBOARDING_TRADE_DEFAULT,
  ONBOARDING_TRADE_OPTIONS,
  type OnboardingFallbackStrategy,
  type OnboardingTradeCategory,
} from "@/lib/onboarding-ai-trade-scripts"
import {
  fetchOnboardingNumberInventory,
  type OnboardingNumberOption,
} from "@/lib/onboarding-number-inventory"
import {
  buildBuyReservation,
  buildPortReservation,
  parseReservationFromSearchParams,
  readOnboardingReservation,
  reservationToSearchParams,
  writeOnboardingReservation,
  clearOnboardingReservation,
  type OnboardingLineReservation,
} from "@/lib/onboarding-reservation"
import {
  completeOnboardingCheckoutClient,
  fetchOnboardingProfile,
  fetchOnboardingProvisionMode,
  patchOnboardingProfile,
  reserveOnboardingNumberClient,
} from "@/lib/onboarding-profile-client"
import { OnboardingBillingStep } from "@/components/onboarding-billing-step"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand-mark"
import { BrandWordmark } from "@/components/brand-wordmark"
import { SITE_NAME } from "@/lib/brand"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { getAppSheetStory } from "@/components/app-sheet-stories"
import { SheetInfoTrigger } from "@/components/sheet-info-trigger"
import {
  ArrowRight,
  ArrowRightLeft,
  Hash,
  Loader2,
  Check,
  Plus,
  RefreshCw,
  X,
  Sparkles,
  CassetteTape,
} from "lucide-react"


const ONBOARDING_NUMBER_LIST_MIN_H = "min-h-[20.5rem]"

interface OnboardingPageProps {
  onComplete: () => void
}

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const totalSteps = 4
  const [onboardingSheetKey, setOnboardingSheetKey] = useState<string | null>(null)

  // Step 1 -- Get a number
  const [numberMethod, setNumberMethod] = useState<"buy" | "port" | null>(null)
  const [areaCode, setAreaCode] = useState("")
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [selectedNumber, setSelectedNumber] = useState("")
  /** Deferred checkout — provisioned only after billing (step 4), not on Continue. */
  const [bufferedLine, setBufferedLine] = useState<OnboardingLineReservation | null>(null)
  const [inventoryNumbers, setInventoryNumbers] = useState<OnboardingNumberOption[]>([])
  const [inventorySource, setInventorySource] = useState<"telnyx" | "demo" | null>(null)
  const [inventoryError, setInventoryError] = useState<string | null>(null)
  const [refreshingInventory, setRefreshingInventory] = useState(false)
  const [portNumber, setPortNumber] = useState("")
  const [portCarrier, setPortCarrier] = useState("")

  // Step 2 -- Add first receptionist (optional)
  const [receptionistName, setReceptionistName] = useState("")
  const [receptionistPhone, setReceptionistPhone] = useState("")
  const [receptionistRate, setReceptionistRate] = useState("")
  const [addedReceptionist, setAddedReceptionist] = useState(false)

  // Step 3 -- AI receptionist vs classic voicemail fallback
  const [fallbackStrategy, setFallbackStrategy] = useState<OnboardingFallbackStrategy>(ONBOARDING_FALLBACK_DEFAULT)
  const [aiTradeCategory, setAiTradeCategory] = useState<OnboardingTradeCategory>(ONBOARDING_TRADE_DEFAULT)
  const [aiGreeting, setAiGreeting] = useState(() => getOnboardingOpeningLine(ONBOARDING_TRADE_DEFAULT))
  const [voicemailGreeting, setVoicemailGreeting] = useState(ONBOARDING_DEFAULT_VOICEMAIL_GREETING)
  const [profileReady, setProfileReady] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [simulationMode, setSimulationMode] = useState(true)
  const [devModeNotice, setDevModeNotice] = useState<string | null>(null)
  const [step1Saving, setStep1Saving] = useState(false)

  function handleAiTradeCategoryChange(category: OnboardingTradeCategory) {
    setAiTradeCategory(category)
    setAiGreeting(getOnboardingOpeningLine(category))
  }

  useEffect(() => {
    void fetchOnboardingProvisionMode().then((mode) => {
      setSimulationMode(mode.simulation_mode)
      setDevModeNotice(mode.notice)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let hydratedLine: OnboardingLineReservation | null = null
      try {
        const profile = await fetchOnboardingProfile()
        if (cancelled) return
        if (profile?.reserved_number) {
          hydratedLine = {
            method: profile.reserved_number_method === "port" ? "port" : "buy",
            display: profile.reserved_number_display ?? profile.reserved_number,
            e164: profile.reserved_number,
            trialNote: "Included in trial",
            portCarrier: profile.port_carrier ?? undefined,
          }
        }
        if (profile?.fallback_type === "ai" || profile?.fallback_type === "voicemail") {
          setFallbackStrategy(profile.fallback_type)
        }
        if (isOnboardingTradeCategory(profile?.trade_category)) {
          setAiTradeCategory(profile.trade_category)
        }
        if (profile?.opening_line?.trim()) {
          if (profile.fallback_type === "voicemail") {
            setVoicemailGreeting(profile.opening_line)
          } else {
            setAiGreeting(profile.opening_line)
          }
        }
      } catch {
        /* Neon profile optional until migration 024 is applied */
      }

      if (!hydratedLine) {
        hydratedLine = readOnboardingReservation()
      }
      if (!hydratedLine && typeof window !== "undefined") {
        hydratedLine = parseReservationFromSearchParams(new URLSearchParams(window.location.search))
      }
      if (hydratedLine) {
        setBufferedLine(hydratedLine)
        writeOnboardingReservation(hydratedLine)
      }

      if (!cancelled) setProfileReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!profileReady) return
    const opening_line = fallbackStrategy === "ai" ? aiGreeting : voicemailGreeting
    const timer = window.setTimeout(() => {
      void patchOnboardingProfile({
        fallback_type: fallbackStrategy,
        trade_category: aiTradeCategory,
        opening_line,
      }).catch(() => {})
    }, 350)
    return () => window.clearTimeout(timer)
  }, [profileReady, fallbackStrategy, aiTradeCategory, aiGreeting, voicemailGreeting])

  const refreshInventory = useCallback(() => {
    if (refreshingInventory || areaCode.length < 3) return
    setRefreshingInventory(true)
    setInventoryError(null)
    void fetchOnboardingNumberInventory(areaCode)
      .then(({ numbers, source }) => {
        setInventoryNumbers(numbers)
        setInventorySource(source)
        setSelectedNumber((prev) => (numbers.some((n) => n.number === prev) ? prev : ""))
      })
      .catch(() => setInventoryError("Could not load numbers. Try again."))
      .finally(() => setRefreshingInventory(false))
  }, [areaCode, refreshingInventory])

  function handleSearch() {
    const ac = areaCode.replace(/\D/g, "").slice(0, 3)
    if (ac.length < 3) return
    setSearching(true)
    setSelectedNumber("")
    setInventoryError(null)
    void fetchOnboardingNumberInventory(ac)
      .then(({ numbers, source }) => {
        setInventoryNumbers(numbers)
        setInventorySource(source)
        setShowResults(true)
      })
      .catch(() => setInventoryError("Could not load numbers. Try again."))
      .finally(() => setSearching(false))
  }

  function handleAddReceptionist() {
    setAddedReceptionist(true)
  }

  const canProceedStep1 =
    (numberMethod === "buy" && selectedNumber) ||
    (numberMethod === "port" && portNumber && portCarrier)

  const canProceedStep2 = true // optional step

  async function handleContinueFromNumberStep() {
    let reservation: OnboardingLineReservation | null = null
    if (numberMethod === "buy") {
      const row = inventoryNumbers.find((n) => n.number === selectedNumber)
      if (!row) return
      reservation = buildBuyReservation(row)
    } else if (numberMethod === "port" && portNumber && portCarrier) {
      reservation = buildPortReservation(portNumber, portCarrier)
    }
    if (!reservation) return
    setStep1Saving(true)
    setBufferedLine(reservation)
    writeOnboardingReservation(reservation)
    try {
      await reserveOnboardingNumberClient({
        reserved_number: reservation.e164,
        reserved_number_display: reservation.display,
        reserved_number_method: reservation.method,
        port_carrier: reservation.portCarrier ?? null,
      })
    } catch {
      /* still advance — sessionStorage holds reservation until billing */
    } finally {
      setStep1Saving(false)
    }
    const params = reservationToSearchParams(reservation)
    router.replace(`/onboarding?${params.toString()}`, { scroll: false })
    setStep(2)
  }

  async function handleLaunchAfterBilling() {
    setLaunchError(null)
    if (!bufferedLine?.e164?.trim()) {
      setLaunchError("Choose a business number in step 1 before launching.")
      return
    }
    if (!simulationMode && bufferedLine.method === "buy" && bufferedLine.fromTelnyx === false) {
      setLaunchError(
        "That number was only a preview. Search your area code again, pick a line from Telnyx inventory, then launch."
      )
      return
    }
    try {
      const profile = await completeOnboardingCheckoutClient({
        reserved_number: bufferedLine.e164,
        reserved_number_display: bufferedLine.display,
        reserved_number_method: bufferedLine.method,
        port_carrier: bufferedLine.portCarrier ?? null,
        fallback_type: fallbackStrategy,
        trade_category: aiTradeCategory,
        opening_line: fallbackStrategy === "ai" ? aiGreeting : voicemailGreeting,
      })
      if (!profile.has_active_subscription || !profile.reserved_number?.trim()) {
        setLaunchError("Activation did not finish. Please try again.")
        return
      }
      clearOnboardingReservation()
      onComplete()
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not activate your account"
      if (msg.includes("025-onboarding-profiles") || msg.includes('relation "profiles"')) {
        setLaunchError(
          "Database update needed: in Neon SQL Editor, run scripts/025-onboarding-profiles-table.sql (see scripts/MIGRATE-ALL.md step 25), then try Launch again."
        )
      } else {
        setLaunchError(msg)
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header with progress */}
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <BrandMark className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <BrandWordmark size="sm" />
          </div>
          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 w-8 rounded-full transition-colors",
                  i + 1 <= step ? "bg-primary" : "bg-border"
                )}
              />
            ))}
            <SheetInfoTrigger
              onPress={() => setOnboardingSheetKey("onboarding-overview")}
              label="About this setup wizard"
              className="h-8 w-8"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {step} of {totalSteps}
          </span>
        </div>
      </header>

      {simulationMode && devModeNotice ? (
        <div
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5"
          role="status"
        >
          <p className="mx-auto max-w-lg text-center text-[11px] leading-relaxed text-amber-200/90">
            {devModeNotice}
          </p>
        </div>
      ) : null}

      {/* Content */}
      <main className="flex flex-1 flex-col items-center px-6 py-8">
        <div className="w-full max-w-lg">

          {/* Step 1: Get a number */}
          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Add your business number</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  The number customers will call. Buy new or port existing. Calls route to your cell (or receptionists).
                </p>
              </div>

              {/* Method selector */}
              <div className="flex gap-3">
                <button
                  onClick={() => { setNumberMethod("buy"); setShowResults(false); setSelectedNumber("") }}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 transition-all",
                    numberMethod === "buy"
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/30"
                  )}
                >
                  <Plus className={cn("h-5 w-5", numberMethod === "buy" ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-sm font-medium", numberMethod === "buy" ? "text-primary" : "text-foreground")}>
                    Buy New
                  </span>
                  <span className="text-[11px] text-muted-foreground">Get a fresh number</span>
                </button>
                <button
                  onClick={() => { setNumberMethod("port"); setShowResults(false); setSelectedNumber("") }}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 transition-all",
                    numberMethod === "port"
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/30"
                  )}
                >
                  <ArrowRightLeft className={cn("h-5 w-5", numberMethod === "port" ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-sm font-medium", numberMethod === "port" ? "text-primary" : "text-foreground")}>
                    Port Existing
                  </span>
                  <span className="text-[11px] text-muted-foreground">Keep your number</span>
                </button>
              </div>

              {/* Buy flow */}
              {numberMethod === "buy" && (
                <div className="flex flex-col gap-4">
                  {!showResults ? (
                    <div className="flex flex-col gap-3">
                      <label htmlFor="onboarding-area-code" className="text-xs font-semibold text-muted-foreground">
                        Search by Area Code
                      </label>
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          submitFormEvent(e)
                          if (areaCode.length >= 3 && !searching) handleSearch()
                        }}
                      >
                        <div className="relative flex-1">
                          <Hash className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            id="onboarding-area-code"
                            type="text"
                            inputMode="numeric"
                            placeholder="e.g. 305, 212, 415"
                            maxLength={3}
                            value={areaCode}
                            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
                            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/35"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={areaCode.length < 3 || searching}
                          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                        >
                          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {inventorySource === "telnyx"
                            ? `Available in (${areaCode}) — real numbers from Telnyx`
                            : `Preview numbers in (${areaCode})`}
                        </p>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={refreshingInventory}
                            onClick={refreshInventory}
                            className={cn(
                              "inline-flex items-center gap-1 text-xs font-semibold text-primary",
                              "transition-[opacity,transform] duration-200",
                              "hover:scale-[1.03] hover:opacity-90 active:scale-[0.98]",
                              "disabled:pointer-events-none disabled:opacity-40"
                            )}
                          >
                            <RefreshCw
                              className={cn("h-3 w-3", refreshingInventory && "animate-spin")}
                              aria-hidden
                            />
                            ↻ Refresh options
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowResults(false)
                              setSelectedNumber("")
                            }}
                            className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary hover:underline"
                          >
                            Change
                          </button>
                        </div>
                      </div>

                      <div className={cn("relative", ONBOARDING_NUMBER_LIST_MIN_H)}>
                        <div
                          className={cn(
                            "flex flex-col gap-3 transition-[opacity,transform] duration-300",
                            refreshingInventory && "pointer-events-none scale-[0.985] opacity-40"
                          )}
                        >
                      {inventoryNumbers.map((num) => {
                        const isSelected = selectedNumber === num.number
                        return (
                          <button
                            key={num.id}
                            type="button"
                            onClick={() => setSelectedNumber(num.number)}
                            className={cn(
                              "relative flex min-h-[4rem] shrink-0 items-center justify-between rounded-xl border p-3.5 pt-8 text-left transition-[border-color,background-color,box-shadow]",
                              isSelected
                                ? "border-primary bg-primary/5 shadow-[var(--electric-glow)] ring-1 ring-primary/40"
                                : "border-border bg-card hover:border-primary/30"
                            )}
                          >
                            {isSelected ? (
                              <span className="absolute right-3 top-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                <Check className="h-3 w-3" aria-hidden />
                                Selected
                              </span>
                            ) : null}
                            <div>
                              <p className="text-sm font-medium tabular-nums text-foreground">{num.number}</p>
                              <p className="text-[11px] text-muted-foreground">{num.type}</p>
                              <p className="text-[10px] font-medium text-primary">{num.trialNote}</p>
                              <p className="text-[10px] text-muted-foreground">{num.afterTrialPrice}</p>
                            </div>
                          </button>
                        )
                      })}
                        </div>
                        {refreshingInventory ? (
                          <div
                            className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
                            aria-hidden
                          >
                            <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-primary/5 via-primary/10 to-primary/5" />
                          </div>
                        ) : null}
                      </div>
                      {inventorySource === "demo" ? (
                        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
                          Live inventory unavailable — showing previews only. Search again or contact support if this persists.
                        </p>
                      ) : null}
                      {inventoryError ? (
                        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                          {inventoryError}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {/* Port flow */}
              {numberMethod === "port" && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-2.5 rounded-xl bg-card p-4">
                    <ArrowRightLeft className="mt-0.5 h-4 w-4 text-primary" />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Port your existing business number to {SITE_NAME}. Takes 24-48 hours with zero downtime.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Phone Number</label>
                    <input
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={portNumber}
                      onChange={(e) => setPortNumber(e.target.value)}
                      className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Current Carrier</label>
                    <input
                      type="text"
                      placeholder="e.g. AT&T, Verizon, T-Mobile"
                      value={portCarrier}
                      onChange={(e) => setPortCarrier(e.target.value)}
                      className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleContinueFromNumberStep}
                disabled={!canProceedStep1 || step1Saving}
                className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                {step1Saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Reserving…
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {/* Step 2: Add first receptionist */}
          {step === 2 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Add a receptionist</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add someone who answers calls for your business. You can skip this and do it later.
                </p>
              </div>

              {!addedReceptionist ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    submitFormEvent(e)
                    if (receptionistName && receptionistPhone) handleAddReceptionist()
                  }}
                >
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Name</label>
                    <input
                      type="text"
                      placeholder="Sarah Miller"
                      value={receptionistName}
                      onChange={(e) => setReceptionistName(e.target.value)}
                      className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Phone Number</label>
                    <input
                      type="tel"
                      placeholder="(555) 234-5678"
                      value={receptionistPhone}
                      onChange={(e) => setReceptionistPhone(e.target.value)}
                      className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Pay Rate (per minute)</label>
                    <input
                      type="text"
                      placeholder="$0.50"
                      value={receptionistRate}
                      onChange={(e) => setReceptionistRate(e.target.value)}
                      className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!receptionistName || !receptionistPhone}
                    className="flex items-center justify-center gap-2 rounded-lg border border-primary bg-primary/10 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                    Add Receptionist
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {receptionistName.split(" ").map(n => n[0]).join("").slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{receptionistName}</p>
                      <p className="text-xs text-muted-foreground">{receptionistPhone} &middot; {receptionistRate}/min</p>
                    </div>
                  </div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                    <Check className="h-3.5 w-3.5 text-primary-foreground" />
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 rounded-lg border border-border bg-card py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Skip for Now
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Fallback strategy (AI vs voicemail) */}
          {step === 3 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Set up your fallback</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  When nobody picks up, choose how callers are handled — live AI intake or a classic voicemail box.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    {
                      id: "ai" as const,
                      title: "AI Receptionist",
                      subtext: "Dynamic live lead intake and information gathering.",
                      icon: Sparkles,
                    },
                    {
                      id: "voicemail" as const,
                      title: "Classic Voicemail",
                      subtext: "Traditional audio recording box for busy windows.",
                      icon: CassetteTape,
                    },
                  ] as const
                ).map((option) => {
                  const Icon = option.icon
                  const isActive = fallbackStrategy === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setFallbackStrategy(option.id)}
                      className={cn(
                        "flex flex-col gap-2.5 rounded-xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-200",
                        isActive
                          ? "border-primary bg-primary/5 shadow-[var(--electric-glow)] ring-1 ring-primary/40"
                          : "border-border bg-card hover:border-primary/30"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-lg",
                          isActive ? "bg-primary/15" : "bg-secondary"
                        )}
                      >
                        <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground">{option.title}</p>
                        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{option.subtext}</p>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="min-h-[15.75rem]">
                {fallbackStrategy === "ai" ? (
                  <div
                    key="fallback-ai"
                    className="animate-fade-in flex flex-col gap-3 duration-200 will-change-[opacity,transform]"
                  >
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="onboarding-trade-category"
                        className="text-xs font-semibold text-muted-foreground"
                      >
                        Select your trade service category:
                      </label>
                      <Select value={aiTradeCategory} onValueChange={handleAiTradeCategoryChange}>
                        <SelectTrigger
                          id="onboarding-trade-category"
                          className="h-10 w-full border-border bg-card text-sm text-foreground shadow-none"
                        >
                          <SelectValue placeholder="General / Other Trades" />
                        </SelectTrigger>
                        <SelectContent>
                          {ONBOARDING_TRADE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="text-xs font-semibold text-muted-foreground">
                      Opening line (first thing AI says)
                    </label>
                    <textarea
                      value={aiGreeting}
                      onChange={(e) => setAiGreeting(e.target.value)}
                      rows={4}
                      className="resize-none rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        "Industry-smart intake",
                        "Lead capture",
                        "Optional SMS to your cell",
                        "Business hours",
                      ].map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    key="fallback-voicemail"
                    className="animate-fade-in flex flex-col gap-3 duration-200 will-change-[opacity,transform]"
                  >
                    <label className="text-xs font-semibold text-muted-foreground">Voicemail Greeting Script:</label>
                    <textarea
                      value={voicemailGreeting}
                      onChange={(e) => setVoicemailGreeting(e.target.value)}
                      rows={5}
                      className="resize-none rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setStep(4)}
                className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 4 && (
            <OnboardingBillingStep
              reservedLine={bufferedLine}
              launchError={launchError}
              onLaunch={handleLaunchAfterBilling}
            />
          )}
        </div>
      </main>

      <Sheet open={onboardingSheetKey != null} onOpenChange={(open) => !open && setOnboardingSheetKey(null)} modal>
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          {(() => {
            const story = onboardingSheetKey ? getAppSheetStory(onboardingSheetKey) : null
            if (!onboardingSheetKey || !story) return null
            return (
              <>
                <StorySheetHeader {...story} />
                <div className="border-t border-border/60 px-4 py-3">
                  <p className="text-[11px] text-muted-foreground">
                    When you finish, open{" "}
                    <Link href="/dashboard" className="font-medium text-primary underline-offset-4 hover:underline">
                      Call console
                    </Link>{" "}
                    for live routing.
                  </p>
                </div>
                <SheetFooter className="border-t border-border/70 bg-secondary/15 px-4 py-3">
                  <p className="text-[11px] text-muted-foreground">Demo steps here may not call real Telnyx APIs until you add numbers in Settings.</p>
                </SheetFooter>
              </>
            )
          })()}
        </SheetContent>
      </Sheet>
    </div>
  )
}
