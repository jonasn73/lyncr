// Register lyncr.app for Apple Pay / Google Pay / Link on Embedded Checkout.

import { getAppUrl } from "@/lib/telnyx"
import { getStripeClient, isStripeConfigured } from "@/lib/stripe-config"

let ensurePromise: Promise<string[]> | null = null

function hostnameFromAppUrl(): string | null {
  try {
    const host = new URL(getAppUrl()).hostname.trim().toLowerCase()
    return host || null
  } catch {
    return null
  }
}

/** Domains that must be registered for wallets on the public pay page. */
export function stripeWalletDomainCandidates(): string[] {
  const out: string[] = []
  const add = (raw: string | null | undefined) => {
    const d = raw?.trim().toLowerCase()
    if (!d || out.includes(d)) return
    // Strip port if any.
    const host = d.split(":")[0] || d
    if (!host || host === "localhost" || host.endsWith(".local")) return
    out.push(host)
  }

  add(hostnameFromAppUrl())
  add("lyncr.app")
  add("www.lyncr.app")
  return out
}

/**
 * Ensure Apple Pay (and other wallet PMDs) can show on Embedded Checkout.
 * Safe to call often — Stripe accepts re-create for existing domains (or we ignore duplicates).
 */
export async function ensureStripeWalletPaymentMethodDomains(): Promise<string[]> {
  if (!isStripeConfigured()) return []
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const stripe = getStripeClient()
      const registered: string[] = []
      for (const domain_name of stripeWalletDomainCandidates()) {
        try {
          const domain = await stripe.paymentMethodDomains.create({ domain_name })
          registered.push(domain.domain_name)
          // If Apple Pay is inactive, ask Stripe to re-validate after association file is live.
          if (domain.apple_pay?.status && domain.apple_pay.status !== "active") {
            try {
              await stripe.paymentMethodDomains.validate(domain.id)
            } catch {
              // Validation may need the association file; ignore — create still registers the domain.
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          // Already registered — list + enable.
          if (/already|exist/i.test(msg)) {
            try {
              const listed = await stripe.paymentMethodDomains.list({ limit: 100 })
              const match = listed.data.find((d) => d.domain_name === domain_name)
              if (match) {
                if (!match.enabled) {
                  await stripe.paymentMethodDomains.update(match.id, { enabled: true })
                }
                if (match.apple_pay?.status !== "active") {
                  await stripe.paymentMethodDomains.validate(match.id).catch(() => null)
                }
                registered.push(domain_name)
              }
            } catch {
              // ignore
            }
          } else {
            console.warn("[stripe-pmd] domain register failed:", domain_name, msg)
          }
        }
      }
      return registered
    })().finally(() => {
      // Allow a later retry after cold start if first pass failed hard.
      // Keep cache for this process lifetime after success/attempt.
    })
  }
  return ensurePromise
}
