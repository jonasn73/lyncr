// Record invoices for jobs paid outside Lyncr (Venmo, cash, other).
// Reuses the same HTML/SMS invoice builders + /r/{token} page as Stripe receipts.
// Also powers invoice history: list, delivery truth, resend, and revise.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getUser, normalizePhoneNumberE164 } from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { makeReceiptToken } from "@/lib/payment-receipt-short-token"
import {
  buildPaymentInvoiceEmailHtml,
  buildPaymentInvoiceEmailSubject,
  buildPaymentInvoiceEmailText,
  buildPaymentInvoiceSms,
  paymentInvoiceFromAddress,
  type PaymentInvoice,
} from "@/lib/payment-invoice"
import { resolveInvoiceBusinessPhone } from "@/lib/invoice-business-phone"

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingRecordInvoicesTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /job_record_invoices/i.test(msg) && /does not exist|undefined_table/i.test(msg)
}

/** True when migration 133 columns are missing (history / delivery fields). */
function isMissingHistoryColumns(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    /invoice_number|delivery_status|channels_requested|email_sent_at|parent_invoice_id|revision/i.test(
      msg
    ) && /does not exist|undefined_column/i.test(msg)
  )
}

export type RecordInvoicePaymentMethod = "VENMO" | "CASH" | "OTHER" | "EXTERNAL"

/** Delivery outcome after email/SMS attempts. */
export type RecordInvoiceDeliveryStatus = "pending" | "sent" | "failed" | "partial"

export type JobRecordInvoiceRow = {
  id: string
  ownerUserId: string
  customerId: string | null
  jobId: string | null
  amountCents: number
  paymentMethod: RecordInvoicePaymentMethod
  paymentNote: string
  customerName: string
  customerEmail: string
  customerPhone: string
  serviceLabel: string
  vehicleLabel: string
  vehicleVin: string
  addressLine1: string
  paidAtIso: string
  receiptToken: string
  createdAtIso: string
  /** INV-XXXXXXXX — stable for search/lists. */
  invoiceNumber: string
  deliveryStatus: RecordInvoiceDeliveryStatus
  channelsRequested: string
  emailSentAtIso: string | null
  smsSentAtIso: string | null
  emailError: string
  smsError: string
  lastSentAtIso: string | null
  revision: number
  parentInvoiceId: string | null
  updatedAtIso: string
}

function paymentMethodLabelForRecord(method: RecordInvoicePaymentMethod): string {
  if (method === "VENMO") return "Venmo"
  if (method === "CASH") return "Cash"
  if (method === "EXTERNAL") return "Outside payment"
  return "Other"
}

function deliveryStatusLabel(status: RecordInvoiceDeliveryStatus): string {
  if (status === "sent") return "Sent"
  if (status === "failed") return "Send failed"
  if (status === "partial") return "Partially sent"
  return "Not sent"
}

function defaultPaymentNote(method: RecordInvoicePaymentMethod): string {
  if (method === "VENMO") return "Paid via Venmo"
  if (method === "CASH") return "Paid in cash"
  if (method === "EXTERNAL") return "Paid outside the app"
  return "Paid outside the app"
}

function formatPaidAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** Build INV-XXXXXXXX from a UUID (used when DB row has no stored number yet). */
function invoiceNumberFromRecordId(id: string): string {
  const bare = id.replace(/-/g, "").toUpperCase()
  const tail = bare.slice(-8) || bare.slice(0, 8) || "RECEIPT"
  return `INV-${tail}`
}

function parseDeliveryStatus(raw: unknown): RecordInvoiceDeliveryStatus {
  const v = String(raw ?? "pending").toLowerCase()
  if (v === "sent" || v === "failed" || v === "partial" || v === "pending") return v
  return "pending"
}

function isoOrNull(raw: unknown): string | null {
  if (raw == null || raw === "") return null
  if (raw instanceof Date) return raw.toISOString()
  const s = String(raw)
  return s || null
}

function parseRecordRow(row: Record<string, unknown>): JobRecordInvoiceRow {
  const methodRaw = String(row.payment_method ?? "VENMO").toUpperCase()
  const paymentMethod: RecordInvoicePaymentMethod =
    methodRaw === "CASH" || methodRaw === "OTHER" || methodRaw === "EXTERNAL"
      ? methodRaw
      : "VENMO"
  const id = String(row.id)
  const storedNumber = String(row.invoice_number ?? "").trim()
  return {
    id,
    ownerUserId: String(row.owner_user_id),
    customerId: row.customer_id != null ? String(row.customer_id) : null,
    jobId: row.job_id != null ? String(row.job_id) : null,
    amountCents: Math.max(0, Math.round(Number(row.amount_cents) || 0)),
    paymentMethod,
    paymentNote: String(row.payment_note ?? ""),
    customerName: String(row.customer_name ?? ""),
    customerEmail: String(row.customer_email ?? ""),
    customerPhone: String(row.customer_phone ?? ""),
    serviceLabel: String(row.service_label ?? ""),
    vehicleLabel: String(row.vehicle_label ?? ""),
    vehicleVin: String(row.vehicle_vin ?? ""),
    addressLine1: String(row.address_line1 ?? ""),
    paidAtIso:
      row.paid_at instanceof Date
        ? row.paid_at.toISOString()
        : String(row.paid_at ?? new Date().toISOString()),
    receiptToken: String(row.receipt_token ?? ""),
    createdAtIso:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? new Date().toISOString()),
    invoiceNumber: storedNumber || invoiceNumberFromRecordId(id),
    deliveryStatus: parseDeliveryStatus(row.delivery_status),
    channelsRequested: String(row.channels_requested ?? ""),
    emailSentAtIso: isoOrNull(row.email_sent_at),
    smsSentAtIso: isoOrNull(row.sms_sent_at),
    emailError: String(row.email_error ?? ""),
    smsError: String(row.sms_error ?? ""),
    lastSentAtIso: isoOrNull(row.last_sent_at),
    revision: Math.max(1, Math.round(Number(row.revision) || 1)),
    parentInvoiceId: row.parent_invoice_id != null ? String(row.parent_invoice_id) : null,
    updatedAtIso:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  }
}

/** Public URL for this invoice’s /r/{token} page. */
function recordInvoicePublicUrl(row: JobRecordInvoiceRow): string {
  const appUrl = getAppUrl().replace(/\/$/, "")
  return `${appUrl}/r/${row.receiptToken}`
}

/** PDF download URL (same auth-less public endpoint as the web page). */
function recordInvoicePdfUrl(row: JobRecordInvoiceRow): string {
  const appUrl = getAppUrl().replace(/\/$/, "")
  return `${appUrl}/api/receipt/${encodeURIComponent(row.receiptToken)}/pdf`
}

/** Build the shared PaymentInvoice shape used by email / SMS / /r page. */
export async function recordInvoiceToPaymentInvoice(
  row: JobRecordInvoiceRow
): Promise<PaymentInvoice> {
  const user = await getUser(row.ownerUserId)
  const businessName =
    (user?.business_name || "").trim() ||
    (user?.name || "").trim() ||
    "Your service provider"
  // Main business DID — not the owner's personal cell.
  const businessPhone = await resolveInvoiceBusinessPhone(row.ownerUserId)
  const note = (row.paymentNote || defaultPaymentNote(row.paymentMethod)).trim()
  const service = row.serviceLabel.trim() || "Service"
  const lineLabel = [service, row.vehicleLabel.trim() || null].filter(Boolean).join(" · ")
  const revSuffix = row.revision > 1 ? ` (rev ${row.revision})` : ""

  return {
    invoiceNumber: `${row.invoiceNumber}${revSuffix}`,
    businessName,
    businessPhone,
    customerName: row.customerName.trim() || null,
    paidAtIso: row.paidAtIso,
    paidAtLabel: formatPaidAt(row.paidAtIso),
    description: service,
    lines: [{ label: lineLabel, amountCents: row.amountCents }],
    subtotalCents: row.amountCents,
    taxCents: 0,
    tipCents: 0,
    totalCents: row.amountCents,
    paymentMethodLabel: paymentMethodLabelForRecord(row.paymentMethod),
    signaturePng: null,
    receiptUrl: recordInvoicePublicUrl(row),
    paymentIntentId: `record_${row.id}`,
    vehicleLabel: row.vehicleLabel.trim() || null,
    vehicleVin: row.vehicleVin.trim() || null,
    addressLine1: row.addressLine1.trim() || null,
    paidNote: note || null,
  }
}

export async function getJobRecordInvoiceByToken(
  token: string
): Promise<JobRecordInvoiceRow | null> {
  const t = token.trim()
  if (!t || t.length < 6 || t.length > 40) return null
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT *
      FROM job_record_invoices
      WHERE receipt_token = ${t}
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? parseRecordRow(row) : null
  } catch (e) {
    if (isMissingRecordInvoicesTable(e)) return null
    throw e
  }
}

export async function getJobRecordInvoiceByIdForOwner(
  ownerUserId: string,
  invoiceId: string
): Promise<JobRecordInvoiceRow | null> {
  const id = invoiceId.trim()
  if (!id) return null
  const sql = getSql()
  try {
    const rows = await sql`
      SELECT *
      FROM job_record_invoices
      WHERE id = ${id}::uuid
        AND owner_user_id = ${ownerUserId}::uuid
      LIMIT 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? parseRecordRow(row) : null
  } catch (e) {
    if (isMissingRecordInvoicesTable(e)) return null
    throw e
  }
}

export type CreateRecordInvoiceInput = {
  ownerUserId: string
  customerId?: string | null
  jobId?: string | null
  amountCents: number
  paymentMethod: RecordInvoicePaymentMethod
  paymentNote?: string | null
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  serviceLabel?: string | null
  vehicleLabel?: string | null
  vehicleVin?: string | null
  addressLine1?: string | null
  paidAtIso?: string | null
  channelsRequested?: string | null
  /** When revising: link to the prior invoice row. */
  parentInvoiceId?: string | null
  revision?: number | null
  /** Keep the same INV-# across revisions (optional). */
  invoiceNumber?: string | null
}

/** Insert a paid-outside invoice row and return it (with receipt token + invoice #). */
export async function createJobRecordInvoice(
  input: CreateRecordInvoiceInput
): Promise<JobRecordInvoiceRow> {
  const amountCents = Math.max(0, Math.round(Number(input.amountCents) || 0))
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Enter an amount greater than $0")
  }
  const method = input.paymentMethod
  const note = (input.paymentNote ?? "").trim() || defaultPaymentNote(method)
  const paidAt =
    input.paidAtIso && !Number.isNaN(Date.parse(input.paidAtIso))
      ? new Date(input.paidAtIso).toISOString()
      : new Date().toISOString()
  const phone = normalizePhoneNumberE164(input.customerPhone ?? "") || ""
  const channelsRequested = (input.channelsRequested ?? "").trim().toLowerCase()
  const revision = Math.max(1, Math.round(Number(input.revision) || 1))
  const parentId = input.parentInvoiceId?.trim() || null
  const sql = getSql()

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = makeReceiptToken()
    // Pre-generate UUID so invoice_number can use the same id.
    const idRows = await sql`SELECT gen_random_uuid() AS id`
    const newId = String((idRows[0] as { id: string }).id)
    const invoiceNumber =
      (input.invoiceNumber ?? "").trim() || invoiceNumberFromRecordId(newId)

    try {
      const rows = await sql`
        INSERT INTO job_record_invoices (
          id, owner_user_id, customer_id, job_id, amount_cents, payment_method,
          payment_note, customer_name, customer_email, customer_phone,
          service_label, vehicle_label, vehicle_vin, address_line1,
          paid_at, receipt_token, created_at,
          invoice_number, delivery_status, channels_requested,
          revision, parent_invoice_id, updated_at
        ) VALUES (
          ${newId}::uuid,
          ${input.ownerUserId}::uuid,
          ${input.customerId?.trim() || null}::uuid,
          ${input.jobId?.trim() || null}::uuid,
          ${amountCents},
          ${method},
          ${note},
          ${(input.customerName ?? "").trim().slice(0, 120)},
          ${(input.customerEmail ?? "").trim().toLowerCase().slice(0, 160)},
          ${phone},
          ${(input.serviceLabel ?? "").trim().slice(0, 160)},
          ${(input.vehicleLabel ?? "").trim().slice(0, 160)},
          ${(input.vehicleVin ?? "").trim().toUpperCase().slice(0, 32)},
          ${(input.addressLine1 ?? "").trim().slice(0, 240)},
          ${paidAt}::timestamptz,
          ${token},
          now(),
          ${invoiceNumber},
          'pending',
          ${channelsRequested.slice(0, 32)},
          ${revision},
          ${parentId}::uuid,
          now()
        )
        RETURNING *
      `
      const row = rows[0] as Record<string, unknown> | undefined
      if (!row) throw new Error("Could not create invoice")
      return parseRecordRow(row)
    } catch (e) {
      if (isMissingRecordInvoicesTable(e)) {
        throw new Error(
          "Database needs migration 132 — run scripts/132-job-record-invoices.sql in Neon SQL Editor"
        )
      }
      if (isMissingHistoryColumns(e)) {
        // Fall back to 132-only insert so sends still work before 133 is run.
        try {
          const rows = await sql`
            INSERT INTO job_record_invoices (
              id, owner_user_id, customer_id, job_id, amount_cents, payment_method,
              payment_note, customer_name, customer_email, customer_phone,
              service_label, vehicle_label, vehicle_vin, address_line1,
              paid_at, receipt_token, created_at
            ) VALUES (
              ${newId}::uuid,
              ${input.ownerUserId}::uuid,
              ${input.customerId?.trim() || null}::uuid,
              ${input.jobId?.trim() || null}::uuid,
              ${amountCents},
              ${method},
              ${note},
              ${(input.customerName ?? "").trim().slice(0, 120)},
              ${(input.customerEmail ?? "").trim().toLowerCase().slice(0, 160)},
              ${phone},
              ${(input.serviceLabel ?? "").trim().slice(0, 160)},
              ${(input.vehicleLabel ?? "").trim().slice(0, 160)},
              ${(input.vehicleVin ?? "").trim().toUpperCase().slice(0, 32)},
              ${(input.addressLine1 ?? "").trim().slice(0, 240)},
              ${paidAt}::timestamptz,
              ${token},
              now()
            )
            RETURNING *
          `
          const row = rows[0] as Record<string, unknown> | undefined
          if (!row) throw new Error("Could not create invoice")
          return parseRecordRow(row)
        } catch (e2) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2)
          if (/duplicate key|unique/i.test(msg2)) continue
          throw new Error(
            "Database needs migration 133 — run scripts/133-job-record-invoice-history.sql in Neon SQL Editor"
          )
        }
      }
      const msg = e instanceof Error ? e.message : String(e)
      if (/duplicate key|unique/i.test(msg)) continue
      throw e
    }
  }
  throw new Error("Could not create invoice link")
}

export type SendRecordInvoiceChannel = "email" | "sms" | "both"

type ChannelAttempt = {
  emailOk: boolean
  smsOk: boolean
  emailError: string
  smsError: string
  channels: string[]
}

/** Persist delivery outcome on the invoice row (migration 133). */
async function updateJobRecordInvoiceDelivery(
  invoiceId: string,
  attempt: ChannelAttempt & { channelsRequested: string }
): Promise<JobRecordInvoiceRow | null> {
  const wantEmail =
    attempt.channelsRequested === "email" || attempt.channelsRequested === "both"
  const wantSms =
    attempt.channelsRequested === "sms" || attempt.channelsRequested === "both"

  let deliveryStatus: RecordInvoiceDeliveryStatus = "failed"
  if (attempt.channels.length > 0) {
    const emailDone = !wantEmail || attempt.emailOk
    const smsDone = !wantSms || attempt.smsOk
    deliveryStatus = emailDone && smsDone ? "sent" : "partial"
  } else if (!wantEmail && !wantSms) {
    deliveryStatus = "pending"
  }

  const nowIso = new Date().toISOString()
  const sql = getSql()
  try {
    const rows = await sql`
      UPDATE job_record_invoices
      SET
        delivery_status = ${deliveryStatus},
        channels_requested = ${attempt.channelsRequested.slice(0, 32)},
        email_sent_at = CASE
          WHEN ${attempt.emailOk} THEN ${nowIso}::timestamptz
          ELSE email_sent_at
        END,
        sms_sent_at = CASE
          WHEN ${attempt.smsOk} THEN ${nowIso}::timestamptz
          ELSE sms_sent_at
        END,
        email_error = ${attempt.emailError.slice(0, 240)},
        sms_error = ${attempt.smsError.slice(0, 240)},
        last_sent_at = ${nowIso}::timestamptz,
        updated_at = now()
      WHERE id = ${invoiceId}::uuid
      RETURNING *
    `
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? parseRecordRow(row) : null
  } catch (e) {
    if (isMissingHistoryColumns(e) || isMissingRecordInvoicesTable(e)) {
      // History columns missing — send still happened; skip persistence.
      return null
    }
    throw e
  }
}

/** Email and/or SMS a record invoice (no Stripe charge required). Updates delivery fields. */
export async function sendJobRecordInvoice(params: {
  userId: string
  invoice: JobRecordInvoiceRow
  channel: SendRecordInvoiceChannel
  email?: string | null
  phone?: string | null
  customerName?: string | null
}): Promise<{
  sent: boolean
  error?: string
  receiptUrl?: string
  channels: string[]
  deliveryStatus: RecordInvoiceDeliveryStatus
  invoice: JobRecordInvoiceRow
}> {
  const invoiceModel = await recordInvoiceToPaymentInvoice(params.invoice)
  if ((params.customerName ?? "").trim()) {
    invoiceModel.customerName = params.customerName!.trim()
  }

  const channels: string[] = []
  const wantEmail = params.channel === "email" || params.channel === "both"
  const wantSms = params.channel === "sms" || params.channel === "both"
  let emailOk = false
  let smsOk = false
  let emailError = ""
  let smsError = ""
  let lastError: string | undefined

  if (wantEmail) {
    const email = (params.email ?? params.invoice.customerEmail ?? "").trim().toLowerCase()
    if (!email.includes("@") || email.length < 5) {
      emailError = "Enter a valid email address"
      lastError = emailError
      if (params.channel === "email") {
        const updated =
          (await updateJobRecordInvoiceDelivery(params.invoice.id, {
            emailOk: false,
            smsOk: false,
            emailError,
            smsError: "",
            channels: [],
            channelsRequested: params.channel,
          })) || params.invoice
        return {
          sent: false,
          error: emailError,
          channels,
          receiptUrl: invoiceModel.receiptUrl,
          deliveryStatus: "failed",
          invoice: updated,
        }
      }
    } else {
      const apiKey = process.env.RESEND_API_KEY?.trim()
      if (!apiKey) {
        emailError = "Email is not configured (RESEND_API_KEY)"
        lastError = emailError
        if (params.channel === "email") {
          const updated =
            (await updateJobRecordInvoiceDelivery(params.invoice.id, {
              emailOk: false,
              smsOk: false,
              emailError,
              smsError: "",
              channels: [],
              channelsRequested: params.channel,
            })) || params.invoice
          return {
            sent: false,
            error: emailError,
            channels,
            receiptUrl: invoiceModel.receiptUrl,
            deliveryStatus: "failed",
            invoice: updated,
          }
        }
      } else {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: paymentInvoiceFromAddress(invoiceModel.businessName),
              to: email,
              subject: buildPaymentInvoiceEmailSubject(invoiceModel),
              html: buildPaymentInvoiceEmailHtml(invoiceModel),
              text: buildPaymentInvoiceEmailText(invoiceModel),
            }),
          })
          if (!res.ok) {
            emailError = "Email could not be sent"
            lastError = emailError
            if (params.channel === "email") {
              const updated =
                (await updateJobRecordInvoiceDelivery(params.invoice.id, {
                  emailOk: false,
                  smsOk: false,
                  emailError,
                  smsError: "",
                  channels: [],
                  channelsRequested: params.channel,
                })) || params.invoice
              return {
                sent: false,
                error: emailError,
                channels,
                receiptUrl: invoiceModel.receiptUrl,
                deliveryStatus: "failed",
                invoice: updated,
              }
            }
          } else {
            emailOk = true
            channels.push("email")
          }
        } catch {
          emailError = "Email send failed"
          lastError = emailError
          if (params.channel === "email") {
            const updated =
              (await updateJobRecordInvoiceDelivery(params.invoice.id, {
                emailOk: false,
                smsOk: false,
                emailError,
                smsError: "",
                channels: [],
                channelsRequested: params.channel,
              })) || params.invoice
            return {
              sent: false,
              error: emailError,
              channels,
              receiptUrl: invoiceModel.receiptUrl,
              deliveryStatus: "failed",
              invoice: updated,
            }
          }
        }
      }
    }
  }

  if (wantSms) {
    const toE164 =
      normalizePhoneNumberE164(params.phone ?? "") ||
      normalizePhoneNumberE164(params.invoice.customerPhone) ||
      ""
    if (!toE164) {
      smsError = "Enter a valid phone number"
      lastError = lastError || smsError
      if (params.channel === "sms") {
        const updated =
          (await updateJobRecordInvoiceDelivery(params.invoice.id, {
            emailOk: false,
            smsOk: false,
            emailError: "",
            smsError,
            channels: [],
            channelsRequested: params.channel,
          })) || params.invoice
        return {
          sent: false,
          error: smsError,
          channels,
          receiptUrl: invoiceModel.receiptUrl,
          deliveryStatus: "failed",
          invoice: updated,
        }
      }
    } else {
      const text = buildPaymentInvoiceSms(invoiceModel)
      const result = await sendTelnyxSms({
        userId: params.userId,
        toE164,
        text,
      })
      if (!result.ok) {
        smsError = result.error || "SMS could not be sent"
        lastError = smsError
        if (params.channel === "sms") {
          const updated =
            (await updateJobRecordInvoiceDelivery(params.invoice.id, {
              emailOk: false,
              smsOk: false,
              emailError: "",
              smsError,
              channels: [],
              channelsRequested: params.channel,
            })) || params.invoice
          return {
            sent: false,
            error: smsError,
            channels,
            receiptUrl: invoiceModel.receiptUrl,
            deliveryStatus: "failed",
            invoice: updated,
          }
        }
      } else {
        smsOk = true
        channels.push("sms")
      }
    }
  }

  const updated =
    (await updateJobRecordInvoiceDelivery(params.invoice.id, {
      emailOk,
      smsOk,
      emailError,
      smsError,
      channels,
      channelsRequested: params.channel,
    })) || params.invoice

  if (channels.length === 0) {
    return {
      sent: false,
      error: lastError || "Could not send invoice",
      channels,
      receiptUrl: invoiceModel.receiptUrl,
      deliveryStatus: updated.deliveryStatus || "failed",
      invoice: updated,
    }
  }

  const deliveryStatus = updated.deliveryStatus
  return {
    sent: deliveryStatus === "sent" || deliveryStatus === "partial",
    channels,
    receiptUrl: invoiceModel.receiptUrl,
    error: lastError,
    deliveryStatus,
    invoice: updated,
  }
}

/** List invoices for an owner — optional customer/job filter + search. */
export async function listJobRecordInvoicesForOwner(params: {
  ownerUserId: string
  customerId?: string | null
  jobId?: string | null
  q?: string | null
  limit?: number
}): Promise<JobRecordInvoiceRow[]> {
  const limit = Math.min(100, Math.max(1, Math.round(Number(params.limit) || 50)))
  const q = (params.q ?? "").trim()
  const customerId = params.customerId?.trim() || null
  const jobId = params.jobId?.trim() || null
  const sql = getSql()

  try {
    // Search by name, phone digits, or invoice number.
    const phoneDigits = q.replace(/\D/g, "")
    const like = q ? `%${q}%` : null
    const phoneLike = phoneDigits.length >= 3 ? `%${phoneDigits}%` : null

    const rows = await sql`
      SELECT *
      FROM job_record_invoices
      WHERE owner_user_id = ${params.ownerUserId}::uuid
        AND (${customerId}::uuid IS NULL OR customer_id = ${customerId}::uuid)
        AND (${jobId}::uuid IS NULL OR job_id = ${jobId}::uuid)
        AND (
          ${like}::text IS NULL
          OR customer_name ILIKE ${like}
          OR customer_phone ILIKE ${like}
          OR customer_email ILIKE ${like}
          OR invoice_number ILIKE ${like}
          OR receipt_token ILIKE ${like}
          OR (${phoneLike}::text IS NOT NULL AND regexp_replace(customer_phone, '\\D', '', 'g') LIKE ${phoneLike})
        )
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return (rows as Record<string, unknown>[]).map(parseRecordRow)
  } catch (e) {
    if (isMissingRecordInvoicesTable(e)) return []
    if (isMissingHistoryColumns(e)) {
      // Pre-133: list without invoice_number search.
      try {
        const rows = await sql`
          SELECT *
          FROM job_record_invoices
          WHERE owner_user_id = ${params.ownerUserId}::uuid
            AND (${customerId}::uuid IS NULL OR customer_id = ${customerId}::uuid)
            AND (${jobId}::uuid IS NULL OR job_id = ${jobId}::uuid)
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
        return (rows as Record<string, unknown>[]).map(parseRecordRow)
      } catch {
        return []
      }
    }
    throw e
  }
}

/** Create a revised copy (new token + revision++) then send — never silently overwrites. */
export async function reviseAndSendJobRecordInvoice(params: {
  userId: string
  source: JobRecordInvoiceRow
  channel: SendRecordInvoiceChannel
  amountCents?: number | null
  paymentMethod?: RecordInvoicePaymentMethod | null
  paymentNote?: string | null
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  serviceLabel?: string | null
  vehicleLabel?: string | null
  vehicleVin?: string | null
  addressLine1?: string | null
}): Promise<{
  sent: boolean
  error?: string
  receiptUrl?: string
  channels: string[]
  deliveryStatus: RecordInvoiceDeliveryStatus
  invoice: JobRecordInvoiceRow
}> {
  const src = params.source
  const revised = await createJobRecordInvoice({
    ownerUserId: params.userId,
    customerId: src.customerId,
    jobId: src.jobId,
    amountCents: params.amountCents ?? src.amountCents,
    paymentMethod: params.paymentMethod ?? src.paymentMethod,
    paymentNote: params.paymentNote ?? src.paymentNote,
    customerName: params.customerName ?? src.customerName,
    customerEmail: params.customerEmail ?? src.customerEmail,
    customerPhone: params.customerPhone ?? src.customerPhone,
    serviceLabel: params.serviceLabel ?? src.serviceLabel,
    vehicleLabel: params.vehicleLabel ?? src.vehicleLabel,
    vehicleVin: params.vehicleVin ?? src.vehicleVin,
    addressLine1: params.addressLine1 ?? src.addressLine1,
    paidAtIso: src.paidAtIso,
    channelsRequested: params.channel,
    parentInvoiceId: src.id,
    revision: src.revision + 1,
    invoiceNumber: src.invoiceNumber,
  })

  return sendJobRecordInvoice({
    userId: params.userId,
    invoice: revised,
    channel: params.channel,
    email: params.customerEmail ?? revised.customerEmail,
    phone: params.customerPhone ?? revised.customerPhone,
    customerName: params.customerName ?? revised.customerName,
  })
}

/** JSON shape for API / UI lists. */
export function jobRecordInvoiceToApi(row: JobRecordInvoiceRow) {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    customerId: row.customerId,
    jobId: row.jobId,
    amountCents: row.amountCents,
    paymentMethod: row.paymentMethod,
    paymentMethodLabel: paymentMethodLabelForRecord(row.paymentMethod),
    paymentNote: row.paymentNote,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    serviceLabel: row.serviceLabel,
    vehicleLabel: row.vehicleLabel,
    vehicleVin: row.vehicleVin,
    addressLine1: row.addressLine1,
    paidAt: row.paidAtIso,
    createdAt: row.createdAtIso,
    updatedAt: row.updatedAtIso,
    receiptToken: row.receiptToken,
    receiptUrl: recordInvoicePublicUrl(row),
    pdfUrl: recordInvoicePdfUrl(row),
    deliveryStatus: row.deliveryStatus,
    deliveryStatusLabel: deliveryStatusLabel(row.deliveryStatus),
    channelsRequested: row.channelsRequested,
    emailSentAt: row.emailSentAtIso,
    smsSentAt: row.smsSentAtIso,
    emailError: row.emailError,
    smsError: row.smsError,
    lastSentAt: row.lastSentAtIso,
    revision: row.revision,
    parentInvoiceId: row.parentInvoiceId,
    emailOk: Boolean(row.emailSentAtIso),
    smsOk: Boolean(row.smsSentAtIso),
  }
}

export type JobRecordInvoiceApi = ReturnType<typeof jobRecordInvoiceToApi>
