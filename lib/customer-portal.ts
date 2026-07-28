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
}): { title: string; body: string; nextHint: string } {
  if (opts.mode === "callback") {
    return {
      title: "Request received",
      body: "Thanks — we got your info. A technician will follow up ASAP to confirm a time.",
      nextHint: "Keep an eye on your phone — we'll call or text you shortly.",
    }
  }
  if (opts.depositSuccess) {
    return {
      title: "Deposit received",
      body: "Your appointment slot is confirmed. We will follow up shortly.",
      nextHint: "You're all set for now. After the visit, we may text a review link.",
    }
  }
  return {
    title: "Booking received",
    body: "Thanks — we received your details and preferred time. A dispatcher will confirm shortly.",
    nextHint: "If a deposit is required, you'll get a secure pay link by text.",
  }
}
