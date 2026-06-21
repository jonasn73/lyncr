// Telnyx LNP (local number portability) — programmatic port-in submission.

import { getAppUrl } from "@/lib/telnyx"
import { mapTelnyxStatusToPortingOrderStatus } from "@/lib/db"
import { buildZingCustomerReference } from "@/lib/telnyx-customer-reference"
import type { PortingOrderStatus } from "@/lib/types"

const TELNYX_BASE = "https://api.telnyx.com/v2"

export type TelnyxLnpSubmitInput = {
  userId: string
  organizationId?: string | null
  phoneNumber: string
  accountName: string
  authorizedPerson: string
  accountNumber: string
  pin?: string
  streetAddress: string
  city: string
  state: string
  zip: string
  invoiceBase64?: string
  invoiceFilename?: string
  lineLabel: string
}

export type TelnyxLnpSubmitResult = {
  e164: string
  telnyxOrderId: string
  telnyxStatus: string
  orderStatus: PortingOrderStatus
  confirmSuccess: boolean
  confirmError?: string
  fastPortable: boolean
}

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY
  if (!key) throw new Error("Missing TELNYX_API_KEY")
  return key
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getApiKey()}`,
  }
}

export function toPortE164(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return raw.startsWith("+") ? raw : `+${digits}`
}

async function telnyxFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${TELNYX_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  })
  const body = await res.json()
  if (!res.ok) {
    const errMsg =
      body?.errors?.[0]?.detail ||
      body?.errors?.[0]?.title ||
      body?.message ||
      JSON.stringify(body)
    throw new Error(`Telnyx ${res.status}: ${errMsg}`)
  }
  return body
}

async function telnyxFetchRaw(path: string): Promise<Buffer> {
  const res = await fetch(`${TELNYX_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  })
  if (!res.ok) throw new Error(`Telnyx ${res.status} fetching ${path}`)
  return Buffer.from(await res.arrayBuffer())
}

async function uploadDocument(pdfBuffer: Buffer, filename: string): Promise<string> {
  const res = await fetch(`${TELNYX_BASE}/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      file: pdfBuffer.toString("base64"),
      filename,
      customer_reference: "lyncr-port-invoice",
    }),
  })
  const body = await res.json()
  if (!res.ok) {
    const errMsg = body?.errors?.[0]?.detail || body?.errors?.[0]?.title || JSON.stringify(body)
    throw new Error(`Document upload failed (${res.status}): ${errMsg}`)
  }
  const docId = body?.data?.id
  if (!docId) throw new Error("Document upload returned no ID")
  return docId
}

/** Classify Telnyx auth / signature errors for owner-facing responses. */
export function classifyTelnyxPortError(msg: string): { status: number; error: string } {
  if (/feature not permitted|not permitted|10038/i.test(msg)) {
    return { status: 403, error: "Number porting isn't available on your current plan. Please contact support." }
  }
  if (/invalid.*token|unauthorized|authentication|signature|40301|401/i.test(msg)) {
    return {
      status: 401,
      error: "Carrier API rejected our credentials. Contact support — your port was not submitted.",
    }
  }
  if (/portab|not portable|invalid number/i.test(msg)) {
    return { status: 400, error: `This number may not be portable: ${msg.replace(/^Telnyx \d+:\s*/, "")}` }
  }
  if (/account number|pin|billing|admin/i.test(msg)) {
    return {
      status: 400,
      error: `Carrier rejected the account details. Double-check your account number and PIN: ${msg.replace(/^Telnyx \d+:\s*/, "")}`,
    }
  }
  return { status: 500, error: msg.replace(/^Telnyx \d+:\s*/, "") || "Failed to submit port request" }
}

/** Submit a formal Telnyx LNP port order (portability check → draft → LOA → invoice → confirm). */
export async function submitTelnyxLnpPort(input: TelnyxLnpSubmitInput): Promise<TelnyxLnpSubmitResult> {
  const e164 = toPortE164(input.phoneNumber)

  let fastPortable = false
  try {
    const portCheck = await telnyxFetch("/portability_checks", {
      method: "POST",
      body: JSON.stringify({ phone_numbers: [e164] }),
    })
    const entry = portCheck?.data?.[0] || {}
    if (entry.portable === false) {
      throw new Error(
        `This number can't be ported: ${entry.not_portable_reason || "unknown reason"}. Contact your current carrier.`
      )
    }
    fastPortable = entry.fast_portable === true
  } catch (e) {
    if (e instanceof Error && e.message.includes("can't be ported")) throw e
  }

  const createRes = await telnyxFetch("/porting_orders", {
    method: "POST",
    body: JSON.stringify({ phone_numbers: [e164] }),
  })
  const ordersArr = createRes?.data
  const orderId: string | undefined = Array.isArray(ordersArr) ? ordersArr[0]?.id : ordersArr?.id
  if (!orderId) throw new Error("Failed to create port order with carrier")

  await telnyxFetch(`/porting_orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({
      misc: { type: "full" },
      end_user: {
        admin: {
          entity_name: input.accountName,
          auth_person_name: input.authorizedPerson,
          billing_phone_number: e164,
          account_number: input.accountNumber || undefined,
          pin_passcode: input.pin || undefined,
        },
        location: {
          street_address: input.streetAddress,
          locality: input.city,
          administrative_area: input.state,
          postal_code: input.zip,
          country_code: "US",
        },
      },
      customer_reference: buildZingCustomerReference(input.userId, input.organizationId),
    }),
  })

  const portingWebhookUrl = `${getAppUrl().replace(/\/$/, "")}/api/webhooks/telnyx`
  try {
    await telnyxFetch(`/porting_orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ webhook_url: portingWebhookUrl }),
    })
  } catch {
    // non-fatal
  }

  let focDatetime: string
  try {
    const focWindows = await telnyxFetch(`/porting_orders/${orderId}/allowed_foc_windows`)
    const windows = focWindows?.data || []
    if (windows.length > 0) {
      focDatetime = windows[0].started_at || windows[0].foc_datetime
    } else {
      throw new Error("No FOC windows")
    }
  } catch {
    const focDate = new Date()
    let bdays = 0
    while (bdays < 1) {
      focDate.setDate(focDate.getDate() + 1)
      const dow = focDate.getDay()
      if (dow !== 0 && dow !== 6) bdays++
    }
    focDate.setUTCHours(12, 0, 0, 0)
    focDatetime = focDate.toISOString()
  }

  await telnyxFetch(`/porting_orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ activation_settings: { foc_datetime_requested: focDatetime } }),
  })

  try {
    const loaPdf = await telnyxFetchRaw(`/porting_orders/${orderId}/loa_template`)
    const docId = await uploadDocument(loaPdf, `loa-${orderId}.pdf`)
    await telnyxFetch(`/porting_orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ documents: { loa: docId } }),
    })
  } catch (loaErr) {
    console.error("[telnyx-lnp] LOA attach failed:", loaErr)
  }

  if (!input.invoiceBase64) {
    console.warn(`[telnyx-lnp] No invoice for order ${orderId} — carrier may reject`)
  } else {
    try {
      const invoiceBuffer = Buffer.from(input.invoiceBase64, "base64")
      const fname = input.invoiceFilename || `invoice-${orderId}.pdf`
      const invoiceDocId = await uploadDocument(invoiceBuffer, fname)
      await telnyxFetch(`/porting_orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ documents: { invoice: invoiceDocId } }),
      })
    } catch (invErr) {
      console.error("[telnyx-lnp] Invoice attach failed:", invErr)
      throw new Error(
        invErr instanceof Error
          ? `Invoice upload failed: ${invErr.message}`
          : "Invoice upload failed — please try a smaller PDF or image."
      )
    }
  }

  let submitStatus = "submitted"
  let confirmSuccess = false
  let lastConfirmError = ""

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (attempt === 2) await new Promise((r) => setTimeout(r, 3000))
      const confirmRes = await telnyxFetch(`/porting_orders/${orderId}/actions/confirm`, { method: "POST" })
      const confirmData = confirmRes?.data
      submitStatus =
        (Array.isArray(confirmData) ? confirmData[0]?.porting_order_status : confirmData?.porting_order_status) ||
        "in-process"
      confirmSuccess = true
      break
    } catch (confirmErr: unknown) {
      lastConfirmError = confirmErr instanceof Error ? confirmErr.message : String(confirmErr)
      console.error(`[telnyx-lnp] confirm attempt ${attempt} failed:`, lastConfirmError)
    }
  }

  const telnyxStatus = confirmSuccess ? submitStatus : "draft"
  const orderStatus = mapTelnyxStatusToPortingOrderStatus(telnyxStatus)

  return {
    e164,
    telnyxOrderId: orderId,
    telnyxStatus,
    orderStatus: confirmSuccess ? orderStatus : "pending",
    confirmSuccess,
    confirmError: confirmSuccess ? undefined : lastConfirmError.replace(/^Telnyx \d+:\s*/, ""),
    fastPortable,
  }
}
