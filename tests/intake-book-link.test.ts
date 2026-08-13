import { describe, expect, it } from "vitest"
import {
  buildIntakeBookFormUrl,
  buildIntakeBookLinkSms,
  intakeBookFeeLabel,
  jobTypeFromBookFormKind,
  resolveIntakeBookQuoteCents,
} from "@/lib/intake-book-link"
import {
  COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES,
  COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES_WITH_VENMO,
  collectCheckoutWalletSummary,
  isUnsupportedPaymentMethodError,
} from "@/lib/stripe-collect-payment-methods"
import { SERVICE_CALL_FEE_CENTS } from "@/lib/service-call-fee"

describe("intake book link helpers", () => {
  it("resolves fee cents for each mode", () => {
    expect(resolveIntakeBookQuoteCents("none")).toBe(0)
    expect(resolveIntakeBookQuoteCents("service_call")).toBe(SERVICE_CALL_FEE_CENTS)
    expect(resolveIntakeBookQuoteCents("full_quote", 185)).toBe(18500)
    expect(() => resolveIntakeBookQuoteCents("full_quote", 0)).toThrow(/quote/i)
  })

  it("builds fee labels and form URLs", () => {
    expect(intakeBookFeeLabel("none", 0)).toMatch(/no fee/i)
    expect(intakeBookFeeLabel("service_call", SERVICE_CALL_FEE_CENTS)).toMatch(/49/)
    expect(intakeBookFeeLabel("full_quote", 18500)).toMatch(/185/)
    expect(buildIntakeBookFormUrl("https://lyncr.app/", "abc-123")).toBe(
      "https://lyncr.app/book/form/abc-123"
    )
  })

  it("maps job kinds and SMS copy", () => {
    expect(jobTypeFromBookFormKind("akl")).toMatch(/Origination/)
    expect(jobTypeFromBookFormKind("copy")).toMatch(/Duplication/)
    const sms = buildIntakeBookLinkSms({
      businessLabel: "Key Squad",
      url: "https://lyncr.app/book/form/x",
      feeMode: "none",
      quoteCents: 0,
    })
    expect(sms).toContain("Key Squad")
    expect(sms).toContain("https://lyncr.app/book/form/x")
    expect(sms).toMatch(/no payment/i)
  })
})

describe("collect checkout payment methods", () => {
  it("lists card cashapp link and optional venmo", () => {
    expect(COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES).toContain("card")
    expect(COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES).toContain("cashapp")
    expect(COLLECT_CHECKOUT_PAYMENT_METHOD_TYPES_WITH_VENMO).toContain("venmo")
  })

  it("detects unsupported PM errors and summarizes wallets", () => {
    expect(isUnsupportedPaymentMethodError(new Error("venmo is not activated"))).toBe(true)
    expect(collectCheckoutWalletSummary({ venmoIncluded: true })).toMatch(/Venmo/)
    expect(
      collectCheckoutWalletSummary({ venmoAttempted: true, venmoIncluded: false })
    ).toMatch(/Venmo was not available/)
    expect(collectCheckoutWalletSummary({ dynamicMethods: true })).toMatch(
      /Connected accounts/
    )
  })
})
