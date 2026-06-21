// Telnyx LNP port order corrections — admin resubmit via PATCH /porting_orders/{id}.

import { mapTelnyxStatusToPortingOrderStatus } from "@/lib/db"
import type { PortingOrderStatus } from "@/lib/types"
import { collectPortingStatuses, pickBestPortingStatus } from "@/lib/telnyx-porting-status"

const TELNYX_BASE = "https://api.telnyx.com/v2"

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

async function telnyxFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${TELNYX_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options.headers },
  })
  const body = await res.json().catch(() => ({}))
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

async function uploadDocument(pdfBuffer: Buffer, filename: string): Promise<string> {
  const res = await fetch(`${TELNYX_BASE}/documents`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      file: pdfBuffer.toString("base64"),
      filename,
      customer_reference: "lyncr-port-correction",
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

export type TelnyxPortingCorrectionInput = {
  telnyxOrderId: string
  accountNumber?: string
  pin?: string
  streetAddress?: string
  city?: string
  state?: string
  postalCode?: string
  entityName?: string
  authorizedPerson?: string
  loaBase64?: string
  loaFilename?: string
  invoiceBase64?: string
  invoiceFilename?: string
}

export type TelnyxPortingCorrectionResult = {
  telnyxOrderId: string
  telnyxStatus: string
  orderStatus: PortingOrderStatus
}

/** PATCH Telnyx porting order with corrected billing, PIN, address, or LOA/invoice documents. */
export async function submitTelnyxPortingCorrections(
  input: TelnyxPortingCorrectionInput
): Promise<TelnyxPortingCorrectionResult> {
  const orderId = input.telnyxOrderId.trim()
  if (!orderId) throw new Error("Telnyx order id is required")

  const patch: Record<string, unknown> = {}
  const admin: Record<string, string> = {}
  const location: Record<string, string> = {}

  if (input.accountNumber?.trim()) admin.account_number = input.accountNumber.trim()
  if (input.pin?.trim()) admin.pin_passcode = input.pin.trim()
  if (input.entityName?.trim()) admin.entity_name = input.entityName.trim()
  if (input.authorizedPerson?.trim()) admin.auth_person_name = input.authorizedPerson.trim()
  if (input.streetAddress?.trim()) location.street_address = input.streetAddress.trim()
  if (input.city?.trim()) location.locality = input.city.trim()
  if (input.state?.trim()) location.administrative_area = input.state.trim()
  if (input.postalCode?.trim()) location.postal_code = input.postalCode.trim()

  if (Object.keys(admin).length > 0 || Object.keys(location).length > 0) {
    const endUser: Record<string, unknown> = {}
    if (Object.keys(admin).length > 0) endUser.admin = admin
    if (Object.keys(location).length > 0) {
      endUser.location = { ...location, country_code: "US" }
    }
    patch.end_user = endUser
  }

  if (Object.keys(patch).length > 0) {
    await telnyxFetch(`/porting_orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  }

  const documents: Record<string, string> = {}
  if (input.loaBase64?.trim()) {
    const buf = Buffer.from(input.loaBase64.trim(), "base64")
    documents.loa = await uploadDocument(buf, input.loaFilename?.trim() || `loa-correction-${orderId}.pdf`)
  }
  if (input.invoiceBase64?.trim()) {
    const buf = Buffer.from(input.invoiceBase64.trim(), "base64")
    documents.invoice = await uploadDocument(
      buf,
      input.invoiceFilename?.trim() || `invoice-correction-${orderId}.pdf`
    )
  }
  if (Object.keys(documents).length > 0) {
    await telnyxFetch(`/porting_orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ documents }),
    })
  }

  const refreshed = await telnyxFetch(`/porting_orders/${orderId}?include_phone_numbers=true`)
  const orderData = (refreshed?.data ?? refreshed) as Record<string, unknown>
  const statuses = collectPortingStatuses(orderData)
  const telnyxStatus = pickBestPortingStatus(statuses)
  const orderStatus = mapTelnyxStatusToPortingOrderStatus(telnyxStatus)

  return { telnyxOrderId: orderId, telnyxStatus, orderStatus }
}

/** Read saved PIN/passcode from a Telnyx porting order payload. */
export function readTelnyxPortingPinPasscode(orderData: Record<string, unknown>): string | null {
  const endUser = orderData.end_user as Record<string, unknown> | undefined
  const admin = endUser?.admin as Record<string, unknown> | undefined
  const pin =
    (typeof admin?.pin_passcode === "string" && admin.pin_passcode.trim()) ||
    (typeof admin?.pin === "string" && admin.pin.trim()) ||
    null
  return pin || null
}

/** Re-submit a corrected port order to Telnyx after PATCH (clears many exception states). */
export async function confirmTelnyxPortingOrderCorrection(
  telnyxOrderId: string
): Promise<{ confirmed: boolean; confirmError?: string }> {
  const orderId = telnyxOrderId.trim()
  if (!orderId) throw new Error("Telnyx order id is required")

  try {
    await telnyxFetch(`/porting_orders/${orderId}/actions/confirm`, { method: "POST" })
    return { confirmed: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn("[telnyx-lnp] confirm after correction failed:", msg)
    return { confirmed: false, confirmError: msg.replace(/^Telnyx \d+:\s*/, "") }
  }
}

/** Owner resubmit: PATCH pin_passcode, confirm with Telnyx, then refresh status. */
export async function submitTelnyxPortingPinCorrection(
  telnyxOrderId: string,
  pin: string
): Promise<
  TelnyxPortingCorrectionResult & {
    pin_saved: boolean
    pin_confirmed_on_carrier: boolean
    confirm_error?: string
  }
> {
  const orderId = telnyxOrderId.trim()
  const pinTrimmed = pin.trim()
  if (!orderId) throw new Error("Telnyx order id is required")
  if (!pinTrimmed) throw new Error("Account PIN or passcode is required")

  await telnyxFetch(`/porting_orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ end_user: { admin: { pin_passcode: pinTrimmed } } }),
  })

  const afterPatch = await telnyxFetch(`/porting_orders/${orderId}?include_phone_numbers=true`)
  const patchedData = (afterPatch?.data ?? afterPatch) as Record<string, unknown>
  const savedPin = readTelnyxPortingPinPasscode(patchedData)
  const pinEchoed = savedPin === pinTrimmed

  const confirm = await confirmTelnyxPortingOrderCorrection(orderId)

  const refreshed = await telnyxFetch(`/porting_orders/${orderId}?include_phone_numbers=true`)
  const orderData = (refreshed?.data ?? refreshed) as Record<string, unknown>
  const savedAfterConfirm = readTelnyxPortingPinPasscode(orderData)
  const pinSaved = pinEchoed || savedAfterConfirm === pinTrimmed || confirm.confirmed

  if (!pinSaved) {
    throw new Error(
      "Telnyx did not save your PIN — the carrier API rejected the value. Double-check the transfer PIN from your losing carrier and try again."
    )
  }

  const statuses = collectPortingStatuses(orderData)
  const telnyxStatus = pickBestPortingStatus(statuses)
  const orderStatus = mapTelnyxStatusToPortingOrderStatus(telnyxStatus)

  return {
    telnyxOrderId: orderId,
    telnyxStatus,
    orderStatus,
    pin_saved: true,
    pin_confirmed_on_carrier: confirm.confirmed,
    confirm_error: confirm.confirmError,
  }
}
