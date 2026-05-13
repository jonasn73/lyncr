// ============================================
// POST /api/numbers/port
// ============================================
// Full porting flow:
//   1. Check portability
//   2. Create draft port order
//   3. Fill end-user info + service address
//   4. Check & fulfill requirements (LOA, etc.)
//   5. Confirm (submit) the order
// The customer fills out a form in the app and the port is submitted automatically.

import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromRequest } from "@/lib/auth"
import { getAppUrl } from "@/lib/telnyx"
import { ensurePortingLineRecord } from "@/lib/db"

const TELNYX_BASE = "https://api.telnyx.com/v2"
const MAX_LINE_BUSINESS_NAME_LEN = 120

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

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return raw.startsWith("+") ? raw : `+${digits}`
}

// Generic Telnyx API helper — throws on non-2xx with the actual Telnyx error message
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

// Fetch raw binary (for LOA PDF template download)
async function telnyxFetchRaw(path: string): Promise<Buffer> {
  const res = await fetch(`${TELNYX_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  })
  if (!res.ok) throw new Error(`Telnyx ${res.status} fetching ${path}`)
  const arrayBuf = await res.arrayBuffer()
  return Buffer.from(arrayBuf)
}

// Upload a document (PDF) to Telnyx using base64 JSON and return the document ID
async function uploadDocument(pdfBuffer: Buffer, filename: string): Promise<string> {
  const base64Content = pdfBuffer.toString("base64")

  const res = await fetch(`${TELNYX_BASE}/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      file: base64Content,
      filename,
      customer_reference: "zing-loa",
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

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req.headers.get("cookie"))
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const {
      number,
      account_name,
      authorized_person,
      account_number,
      pin,
      street_address,
      city,
      state,
      zip,
      invoice_base64,
      invoice_filename,
      line_business_name,
    } = body as {
      number: string
      account_name: string
      authorized_person: string
      account_number?: string
      pin?: string
      street_address: string
      city: string
      state: string
      zip: string
      invoice_base64?: string
      invoice_filename?: string
      line_business_name?: string
    }

    if (!number) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 })
    }
    const lineName =
      typeof line_business_name === "string" ? line_business_name.trim().slice(0, MAX_LINE_BUSINESS_NAME_LEN) : ""
    if (!lineName) {
      return NextResponse.json(
        {
          error:
            "Business name for this line is required — this is what your team associates with the number (whisper / caller context).",
        },
        { status: 400 }
      )
    }
    if (!account_name || !authorized_person) {
      return NextResponse.json({ error: "Account name and authorized person are required" }, { status: 400 })
    }
    if (!street_address || !city || !state || !zip) {
      return NextResponse.json({ error: "Full service address is required" }, { status: 400 })
    }

    const e164 = toE164(number)

    // ── Step 1: Check portability ──
    let fastPortable = false
    try {
      const portCheck = await telnyxFetch("/portability_checks", {
        method: "POST",
        body: JSON.stringify({ phone_numbers: [e164] }),
      })
      const entry = portCheck?.data?.[0] || {}
      if (entry.portable === false) {
        return NextResponse.json({
          error: `This number can't be ported: ${entry.not_portable_reason || "unknown reason"}. Contact your current carrier.`,
        }, { status: 400 })
      }
      fastPortable = entry.fast_portable === true
    } catch {
      // Portability check is optional — continue even if it fails
    }

    // ── Step 2: Create draft port order ──
    // Telnyx returns { data: [ ...orders ] } — an array, even for a single number
    const createRes = await telnyxFetch("/porting_orders", {
      method: "POST",
      body: JSON.stringify({ phone_numbers: [e164] }),
    })

    const ordersArr = createRes?.data
    const orderId: string | undefined = Array.isArray(ordersArr) ? ordersArr[0]?.id : ordersArr?.id
    if (!orderId) {
      console.error("[Zing] Unexpected create response:", JSON.stringify(createRes).slice(0, 500))
      return NextResponse.json({ error: "Failed to create port order" }, { status: 500 })
    }
    console.log(`[Zing] Port order created: ${orderId} for ${e164}`)

    await ensurePortingLineRecord({
      user_id: userId,
      number: e164,
      label: lineName,
      port_order_id: orderId,
    })

    // ── Step 3: Fill end-user info, service address, and port type ──
    await telnyxFetch(`/porting_orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({
        misc: {
          type: "full",
        },
        end_user: {
          admin: {
            entity_name: account_name,
            auth_person_name: authorized_person,
            billing_phone_number: e164,
            account_number: account_number || undefined,
            pin: pin || undefined,
          },
          location: {
            street_address,
            locality: city,
            administrative_area: state,
            postal_code: zip,
            country_code: "US",
          },
        },
        customer_reference: `zing-${userId}`,
      }),
    })
    console.log(`[Zing] End-user info filled for order ${orderId}`)

    // Telnyx POSTs port-in events (status changes, comments) to this URL so users see updates in Zing, not only in the Telnyx dashboard inbox.
    const portingWebhookUrl = `${getAppUrl().replace(/\/$/, "")}/api/webhooks/telnyx/porting`
    try {
      await telnyxFetch(`/porting_orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ webhook_url: portingWebhookUrl }),
      })
      console.log(`[Zing] Porting webhook_url set for order ${orderId}`)
    } catch (whErr) {
      console.warn(
        `[Zing] Could not set webhook_url on port order ${orderId} (check Telnyx API / plan):`,
        whErr instanceof Error ? whErr.message : whErr
      )
    }

    // ── Step 3b: Set FOC date (activation_settings, separate PATCH) ──
    // FOC = Firm Order Commitment — the requested date for the port to go live.
    // Try to fetch allowed FOC windows first; fall back to next business day.
    let focDatetime: string
    try {
      const focWindows = await telnyxFetch(`/porting_orders/${orderId}/allowed_foc_windows`)
      const windows = focWindows?.data || []
      if (windows.length > 0) {
        // Use the earliest allowed window
        focDatetime = windows[0].started_at || windows[0].foc_datetime
        console.log(`[Zing] Using earliest allowed FOC window: ${focDatetime}`)
      } else {
        throw new Error("No allowed FOC windows returned")
      }
    } catch (focErr) {
      // Fallback: next business day at noon UTC
      const focDate = new Date()
      let bdays = 0
      while (bdays < 1) {
        focDate.setDate(focDate.getDate() + 1)
        const dow = focDate.getDay()
        if (dow !== 0 && dow !== 6) bdays++
      }
      focDate.setUTCHours(12, 0, 0, 0)
      focDatetime = focDate.toISOString()
      console.log(`[Zing] FOC windows unavailable (${focErr instanceof Error ? focErr.message : focErr}), using fallback: ${focDatetime}`)
    }

    await telnyxFetch(`/porting_orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({
        activation_settings: {
          foc_datetime_requested: focDatetime,
        },
      }),
    })
    console.log(`[Zing] FOC date set for order ${orderId}: ${focDatetime}`)

    // ── Step 4a: Generate and attach LOA (Letter of Authorization) ──
    // Telnyx auto-generates an LOA PDF pre-filled with the end-user info we just set.
    // Download it, upload it as a document, and attach it to the order.
    let loaFulfilled = false
    try {
      console.log(`[Zing] Downloading LOA template for order ${orderId}...`)
      const loaPdf = await telnyxFetchRaw(`/porting_orders/${orderId}/loa_template`)
      console.log(`[Zing] LOA template downloaded (${loaPdf.length} bytes)`)

      const docId = await uploadDocument(loaPdf, `loa-${orderId}.pdf`)
      console.log(`[Zing] LOA uploaded as document ${docId}`)

      await telnyxFetch(`/porting_orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ documents: { loa: docId } }),
      })
      loaFulfilled = true
      console.log(`[Zing] LOA attached to order ${orderId}`)
    } catch (loaErr) {
      const loaMsg = loaErr instanceof Error ? loaErr.message : String(loaErr)
      console.error(`[Zing] LOA auto-fulfill failed for order ${orderId}: ${loaMsg}`)
    }

    // ── Step 4b: Upload and attach invoice (recent carrier bill) ──
    // Telnyx requires a copy of the user's most recent phone bill from their current carrier.
    let invoiceFulfilled = false
    if (invoice_base64) {
      try {
        const invoiceBuffer = Buffer.from(invoice_base64, "base64")
        const fname = invoice_filename || `invoice-${orderId}.pdf`
        console.log(`[Zing] Uploading invoice for order ${orderId} (${invoiceBuffer.length} bytes, ${fname})...`)

        const invoiceDocId = await uploadDocument(invoiceBuffer, fname)
        console.log(`[Zing] Invoice uploaded as document ${invoiceDocId}`)

        await telnyxFetch(`/porting_orders/${orderId}`, {
          method: "PATCH",
          body: JSON.stringify({ documents: { invoice: invoiceDocId } }),
        })
        invoiceFulfilled = true
        console.log(`[Zing] Invoice attached to order ${orderId}`)
      } catch (invErr) {
        const invMsg = invErr instanceof Error ? invErr.message : String(invErr)
        console.error(`[Zing] Invoice upload failed for order ${orderId}: ${invMsg}`)
      }
    } else {
      console.warn(`[Zing] No invoice provided for order ${orderId} — carrier may reject`)
    }

    // ── Step 5: Confirm (submit) the port order ──
    // The correct endpoint is /actions/confirm
    // Try twice — Telnyx sometimes needs a moment to process the LOA attachment
    let submitStatus = "submitted"
    let confirmSuccess = false
    let lastConfirmError = ""

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt === 2) {
          console.log(`[Zing] Retrying confirm for order ${orderId} after 3s...`)
          await new Promise((r) => setTimeout(r, 3000))
        }
        const confirmRes = await telnyxFetch(`/porting_orders/${orderId}/actions/confirm`, {
          method: "POST",
        })
        const confirmData = confirmRes?.data
        submitStatus = (Array.isArray(confirmData) ? confirmData[0]?.porting_order_status : confirmData?.porting_order_status) || "in-process"
        console.log(`[Zing] Port order ${orderId} confirmed on attempt ${attempt}, status: ${submitStatus}`)
        confirmSuccess = true
        break
      } catch (confirmErr: unknown) {
        lastConfirmError = confirmErr instanceof Error ? confirmErr.message : String(confirmErr)
        console.error(`[Zing] Port order ${orderId} confirm attempt ${attempt} failed: ${lastConfirmError}`)
      }
    }

    if (!confirmSuccess) {
      const cleanError = lastConfirmError.replace(/^Telnyx \d+:\s*/, "")
      const docsNote = loaFulfilled && invoiceFulfilled ? " and documents submitted" : loaFulfilled ? " (LOA submitted, invoice missing)" : invoiceFulfilled ? " (invoice submitted, LOA missing)" : ""
      return NextResponse.json({
        success: true,
        status: "draft",
        message: `Port order created${docsNote}. Confirmation pending — ${cleanError}`,
        port: { number: e164, port_order_id: orderId, telnyx_status: "draft", confirm_error: cleanError },
      })
    }

    return NextResponse.json({
      success: true,
      status: submitStatus,
      message: "Your number is being transferred to Zing. This usually takes 1-3 business days. Check Settings for progress.",
      port: {
        number: e164,
        port_order_id: orderId,
        telnyx_status: submitStatus,
        fast_port: fastPortable,
      },
    })
  } catch (error: unknown) {
    console.error("[Zing] Port request error:", error)
    const msg = error instanceof Error ? error.message : String(error)

    if (/feature not permitted|not permitted|10038/i.test(msg)) {
      return NextResponse.json({
        error: "Number porting isn't available on your current plan. Please contact support.",
      }, { status: 403 })
    }
    if (/portab|not portable|invalid number/i.test(msg)) {
      return NextResponse.json({ error: `This number may not be portable: ${msg}` }, { status: 400 })
    }
    return NextResponse.json({ error: msg || "Failed to submit port request" }, { status: 500 })
  }
}
