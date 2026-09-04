"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
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
  startStripeSubscriptionCheckout,
} from "@/lib/onboarding-profile-client"
import {
  normalizeCheckoutSubscriptionTier,
  type CheckoutSubscriptionTier,
} from "@/lib/subscription-checkout"
import { showUpgradeSubscriptionModal } from "@/components/upgrade-subscription-modal"
import { OnboardingBillingStep } from "@/components/onboarding-billing-step"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/brand-mark"
import { BrandWordmark } from "@/components/brand-wordmark"
import { SITE_NAME } from "@/lib/brand"
import { Sheet, SheetContent, SheetFooter, SheetTitle } from "@/components/ui/sheet"
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
} from "lucide-react"


const ONBOARDING_NUMBER_LIST_MIN_H = "min-h-[20.5rem]"

interface OnboardingPageProps {
  onComplete: () => void
}

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [step, setStep] = useState(1)
  const totalSteps = 2
  const [onboardingSheetKey, setOnboardingSheetKey] = useState<string | null>(null)
  const [selectedSubscriptionTier, setSelectedSubscriptionTier] = useState<CheckoutSubscriptionTier>("professional")

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

  const [profileReady, setProfileReady] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [simulationMode, setSimulationMode] = useState(true)
  const [devModeNotice, setDevModeNotice] = useState<string | null>(null)
  const [step1Saving, setStep1Saving] = useState(false)

  useEffect(() => {
    const plan = searchParams.get("plan")
    if (plan) {
      setSelectedSubscriptionTier(normalizeCheckoutSubscriptionTier(plan))
    }
  }, [searchParams])

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
        const { profile } = await fetchOnboardingProfile()
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

  const canProceedStep1 =
    (numberMethod === "buy" && selectedNumber) ||
    (numberMethod === "port" && portNumber && portCarrier)

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reserve number"
      if (msg.toLowerCase().includes("upgrade") || msg.toLowerCase().includes("professional")) {
        showUpgradeSubscriptionModal({ message: msg })
      }
      /* still advance — sessionStorage holds reservation until billing */
    } finally {
      setStep1Saving(false)
    }
    const params = reservationToSearchParams(reservation)
    router.replace(`/onboarding?${params.toString()}`, { scroll: false })
    setStep(2)
  }

  async function handleLaunchAfterBilling(tier: CheckoutSubscriptionTier) {
    setLaunchError(null)
    if (!bufferedLine?.e164?.trim()) {
      setLaunchError("Choose a business number in step 1 before launching.")
      return
    }
    if (!simulationMode && bufferedLine.method === "buy" && bufferedLine.fromTelnyx === false) {
      setLaunchError(
        "That number was only a preview. Search your area code again, pick a line from available inventory, then launch."
      )
      return
    }
    try {
      // Fallback defaults to voicemail — the AI/fallback wizard step was removed (087);
      // full AI Assistant setup now lives in Settings once the account is actually entitled.
      await patchOnboardingProfile({
        reserved_number: bufferedLine.e164,
        reserved_number_display: bufferedLine.display,
        reserved_number_method: bufferedLine.method,
        port_carrier: bufferedLine.portCarrier ?? null,
        fallback_type: "voicemail",
      })

      if (simulationMode) {
        const profile = await completeOnboardingCheckoutClient({
          reserved_number: bufferedLine.e164,
          reserved_number_display: bufferedLine.display,
          reserved_number_method: bufferedLine.method,
          port_carrier: bufferedLine.portCarrier ?? null,
          fallback_type: "voicemail",
        })
        if (!profile.reserved_number?.trim()) {
          setLaunchError("Setup did not finish. Please try again.")
          return
        }
        clearOnboardingReservation()
        onComplete()
        return
      }

      const result = await startStripeSubscriptionCheckout(tier)
      if (result.kind === "upgraded") {
        onComplete()
        return
      }
      window.location.href = result.checkoutUrl
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
      <header className="border-b border-border px-6 py-6">
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
              className="h-9 w-9"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {step} of {totalSteps}
          </span>
        </div>
      </header>

      {simulationMode && devModeNotice ? (
        <div
          className="border-b border-warning/30 bg-warning/10 px-4 py-3"
          role="status"
        >
          <p className="mx-auto max-w-lg text-center text-2xs leading-relaxed text-warning/90">
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
                  <span className="text-2xs text-muted-foreground">Get a fresh number</span>
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
                  <span className="text-2xs text-muted-foreground">Keep your number</span>
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
                            className="w-full rounded-lg border border-border bg-card py-3 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/35"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={areaCode.length < 3 || searching}
                          className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
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
                            ? `Available in (${areaCode}) — real numbers ready to purchase`
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
                              "relative flex min-h-[4rem] shrink-0 items-center justify-between rounded-xl border p-4 pt-8 text-left transition-[border-color,background-color,box-shadow]",
                              isSelected
                                ? "border-primary bg-primary/5 shadow-[var(--electric-glow)] ring-1 ring-primary/40"
                                : "border-border bg-card hover:border-primary/30"
                            )}
                          >
                            {isSelected ? (
                              <span className="absolute right-3 top-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-primary">
                                <Check className="h-3 w-3" aria-hidden />
                                Selected
                              </span>
                            ) : null}
                            <div>
                              <p className="text-sm font-medium tabular-nums text-foreground">{num.number}</p>
                              <p className="text-2xs text-muted-foreground">{num.type}</p>
                              <p className="text-2xs font-medium text-primary">{num.trialNote}</p>
                              <p className="text-2xs text-muted-foreground">{num.afterTrialPrice}</p>
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
                        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning/90">
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
                  <div className="flex items-start gap-3 rounded-xl bg-card p-4">
                    <ArrowRightLeft className="mt-0.5 h-4 w-4 text-primary" />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Port your existing business number to {SITE_NAME}. Takes 24-48 hours with zero downtime.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-muted-foreground">Phone Number</label>
                    <input
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={portNumber}
                      onChange={(e) => setPortNumber(e.target.value)}
                      className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-muted-foreground">Current Carrier</label>
                    <input
                      type="text"
                      placeholder="e.g. AT&T, Verizon, T-Mobile"
                      value={portCarrier}
                      onChange={(e) => setPortCarrier(e.target.value)}
                      className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
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

          {step === 2 && (
            <OnboardingBillingStep
              reservedLine={bufferedLine}
              launchError={launchError}
              selectedTier={selectedSubscriptionTier}
              onTierChange={setSelectedSubscriptionTier}
              simulationMode={simulationMode}
              onLaunch={handleLaunchAfterBilling}
            />
          )}
        </div>
      </main>

      <Sheet open={onboardingSheetKey != null} onOpenChange={(open) => !open && setOnboardingSheetKey(null)} modal>
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          {/* Heading comes from the story body — name the sheet for screen readers. */}
          <SheetTitle className="sr-only">Setup details</SheetTitle>
          {(() => {
            const story = onboardingSheetKey ? getAppSheetStory(onboardingSheetKey) : null
            if (!onboardingSheetKey || !story) return null
            return (
              <>
                <StorySheetHeader {...story} />
                <div className="border-t border-border/60 px-4 py-3">
                  <p className="text-2xs text-muted-foreground">
                    When you finish, open{" "}
                    <Link href="/dashboard" className="font-medium text-primary underline-offset-4 hover:underline">
                      Call console
                    </Link>{" "}
                    for live routing.
                  </p>
                </div>
                <SheetFooter className="border-t border-border/70 bg-secondary/15 px-4 py-3">
                  <p className="text-2xs text-muted-foreground">Demo steps here may not purchase real lines until you add numbers in Settings.</p>
                </SheetFooter>
              </>
            )
          })()}
        </SheetContent>
      </Sheet>
    </div>
  )
}
