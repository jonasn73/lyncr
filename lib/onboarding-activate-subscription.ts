/** @deprecated Activation now flows through Stripe Checkout + webhooks. */
export async function activateOnboardingSubscription(): Promise<never> {
  throw new Error("Use Stripe Checkout — call POST /api/billing/stripe/checkout")
}
