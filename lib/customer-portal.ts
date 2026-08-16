// Shared helpers for the public customer portal (book → pay → review).
// Token/invite based — no logged-in customer accounts.

/** Journey stages shown in the portal step rail. */
export type CustomerPortalStep = "book" | "pay" | "review" | "done"

export type CustomerPortalMode = "book" | "callback" | "pay" | "review"

const STEP_LABELS: Record<CustomerPortalStep, string> = {
  book: "Book",
  pay: "Pay",
  review: "Review",
  done: "Done",
}

/** Human label for a portal step (callback uses Request instead of Book). */
export function customerPortalStepLabel(
  step: CustomerPortalStep,
  mode?: CustomerPortalMode
): string {
  if (mode === "callback" && step === "book") return "Request"
  return STEP_LABELS[step]
}

/**
 * Ordered steps for the current surface.
 * Callback invites skip Pay (tech follows up); pay/review surfaces show a short rail.
 */
export function customerPortalStepsForMode(mode: CustomerPortalMode): CustomerPortalStep[] {
  if (mode === "callback") return ["book", "done"]
  if (mode === "pay") return ["pay", "done"]
  if (mode === "review") return ["review", "done"]
  // Slot booking: book → pay (deposit or later collect) → done
  return ["book", "pay", "done"]
}

/** Success / next-action copy after book or callback submit. */
export function customerPortalBookSuccessCopy(opts: {
  mode: "book" | "callback"
  depositSuccess?: boolean
  /** Emergency / ASAP path — no time window was collected. */
  asap?: boolean
  /** Preferred window label when the customer scheduled. */
  availabilityLabel?: string
}): { title: string; body: string; nextHint: string } {
  if (opts.asap) {
    return {
      title: "ASAP request received",
      body: "Thanks — we marked this as ASAP. Someone will call or text to confirm when we can help.",
      nextHint: "Keep your phone close — we'll reach out shortly.",
    }
  }
  if (opts.mode === "callback") {
    const windowBit = opts.availabilityLabel?.trim()
      ? ` We noted you're free ${opts.availabilityLabel.trim()}.`
      : ""
    return {
      title: "Request received",
      body: `Thanks — we got your info.${windowBit} A technician will follow up to confirm a time.`,
      nextHint: "Keep an eye on your phone — we'll call or text you shortly.",
    }
  }
  if (opts.depositSuccess) {
    return {
      title: "Deposit received",
      body: "Your appointment window is held. We will follow up shortly.",
      nextHint: "You're all set for now. After the visit, we may text a review link.",
    }
  }
  const windowBit = opts.availabilityLabel?.trim()
    ? ` Preferred window: ${opts.availabilityLabel.trim()}.`
    : ""
  return {
    title: "Booking received",
    body: `Thanks — we received your details.${windowBit} We'll follow up to confirm a time.`,
    nextHint: "If a deposit is required, you'll get a secure pay link by text.",
  }
}
