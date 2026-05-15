"use client"

import { useState } from "react"
import { DEFAULT_BUSY_GENERIC } from "@/lib/ai-intake-defaults" // Default opening line for the voice AI (high-volume tone, not "we're closed")
import { cn } from "@/lib/utils"
import { SITE_NAME } from "@/lib/brand"
import {
  Phone,
  ArrowRight,
  ArrowRightLeft,
  Hash,
  Loader2,
  Check,
  Plus,
  X,
  Sparkles,
} from "lucide-react"

interface OnboardingPageProps {
  onComplete: () => void
}

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState(1)
  const totalSteps = 3

  // Step 1 -- Get a number
  const [numberMethod, setNumberMethod] = useState<"buy" | "port" | null>(null)
  const [areaCode, setAreaCode] = useState("")
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [selectedNumber, setSelectedNumber] = useState("")
  const [portNumber, setPortNumber] = useState("")
  const [portCarrier, setPortCarrier] = useState("")

  // Step 2 -- Add first receptionist (optional)
  const [receptionistName, setReceptionistName] = useState("")
  const [receptionistPhone, setReceptionistPhone] = useState("")
  const [receptionistRate, setReceptionistRate] = useState("")
  const [addedReceptionist, setAddedReceptionist] = useState(false)

  // Step 3 -- Configure AI fallback
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiGreeting, setAiGreeting] = useState(DEFAULT_BUSY_GENERIC) // Same default as dashboard / AI flow

  const availableNumbers = [
    { number: `(${areaCode || "555"}) 100-4001`, type: "Local", price: "$2.99/mo" },
    { number: `(${areaCode || "555"}) 100-4022`, type: "Local", price: "$2.99/mo" },
    { number: `(${areaCode || "555"}) 888-7100`, type: "Toll-Free", price: "$4.99/mo" },
    { number: `(${areaCode || "555"}) 200-3055`, type: "Local", price: "$2.99/mo" },
  ]

  function handleSearch() {
    setSearching(true)
    setTimeout(() => {
      setSearching(false)
      setShowResults(true)
    }, 800)
  }

  function handleAddReceptionist() {
    setAddedReceptionist(true)
  }

  const canProceedStep1 =
    (numberMethod === "buy" && selectedNumber) ||
    (numberMethod === "port" && portNumber && portCarrier)

  const canProceedStep2 = true // optional step

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header with progress */}
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Phone className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold text-foreground">{SITE_NAME}</span>
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
          </div>
          <span className="text-xs text-muted-foreground">
            {step} of {totalSteps}
          </span>
        </div>
      </header>

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
                      <label className="text-xs font-semibold text-muted-foreground">Search by Area Code</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Hash className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            type="text"
                            placeholder="e.g. 305, 212, 415"
                            maxLength={3}
                            value={areaCode}
                            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
                            className="w-full rounded-lg border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                          />
                        </div>
                        <button
                          onClick={handleSearch}
                          disabled={areaCode.length < 3}
                          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                        >
                          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">Available in ({areaCode})</p>
                        <button
                          onClick={() => { setShowResults(false); setSelectedNumber("") }}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Change
                        </button>
                      </div>
                      {availableNumbers.map((num) => (
                        <button
                          key={num.number}
                          onClick={() => setSelectedNumber(num.number)}
                          className={cn(
                            "flex items-center justify-between rounded-xl border p-3.5 text-left transition-all",
                            selectedNumber === num.number
                              ? "border-primary bg-primary/5"
                              : "border-border bg-card hover:border-primary/30"
                          )}
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">{num.number}</p>
                            <p className="text-[11px] text-muted-foreground">{num.type}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">{num.price}</span>
                            {selectedNumber === num.number && (
                              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                                <Check className="h-3 w-3 text-primary-foreground" />
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
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
                onClick={() => setStep(2)}
                disabled={!canProceedStep1}
                className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
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
                <div className="flex flex-col gap-4">
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
                    onClick={handleAddReceptionist}
                    disabled={!receptionistName || !receptionistPhone}
                    className="flex items-center justify-center gap-2 rounded-lg border border-primary bg-primary/10 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                    Add Receptionist
                  </button>
                </div>
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

          {/* Step 3: AI fallback */}
          {step === 3 && (
            <div className="flex flex-col gap-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Set up AI fallback</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  When nobody picks up, your AI receptionist answers with a script for your trade, captures job details, and can text you leads.
                </p>
              </div>

              {/* Toggle */}
              <button
                onClick={() => setAiEnabled(!aiEnabled)}
                className={cn(
                  "flex items-center justify-between rounded-xl border p-4 transition-all",
                  aiEnabled ? "border-primary bg-primary/5" : "border-border bg-card"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg",
                    aiEnabled ? "bg-primary/10" : "bg-secondary"
                  )}>
                    <Sparkles className={cn("h-5 w-5", aiEnabled ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-foreground">AI receptionist</p>
                    <p className="text-[11px] text-muted-foreground">Voice AI for missed calls — industry intake and lead capture</p>
                  </div>
                </div>
                <div
                  className={cn(
                    "relative flex h-7 w-12 items-center rounded-full px-0.5 transition-all",
                    aiEnabled ? "bg-primary" : "bg-muted-foreground/30"
                  )}
                >
                  <div
                    className={cn(
                      "h-6 w-6 rounded-full shadow-sm transition-all",
                      aiEnabled ? "translate-x-5 bg-primary-foreground" : "translate-x-0 bg-background"
                    )}
                  />
                </div>
              </button>

              {/* Greeting editor */}
              {aiEnabled && (
                <div className="flex flex-col gap-3">
                  <label className="text-xs font-semibold text-muted-foreground">Opening line (first thing AI says)</label>
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
              )}

              <button
                onClick={onComplete}
                className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Launch My Business Line
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
