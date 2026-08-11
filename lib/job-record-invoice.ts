// Record invoices for jobs paid outside Lyncr (Venmo, cash, other).
// Reuses the same HTML/SMS invoice builders + /r/{token} page as Stripe receipts.

import { neon } from "@neondatabase/serverless"
import { resolveNeonDatabaseUrl } from "@/lib/neon-database-url"
import { getUser, normalizePhoneNumberE164 } from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"
import { sendTelnyxSms } from "@/lib/telnyx-sms"
import { makeReceiptToken } from "@/lib/payment-receipt-short-token"
import {
  buildPaymentInvoiceEmailHtml,
  buildPaymentInvoiceEmailText,
  buildPaymentInvoiceSms,
  type PaymentInvoice,
} from "@/lib/payment-invoice"

function getSql() {
  return neon(resolveNeonDatabaseUrl())
}

function isMissingRecordInvoicesTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /job_record_invoices/i.test(msg) && /does not exist|undefined_table/i.test(msg)
}

export type RecordInvoicePaymentMethod = "VENMO" | "CASH" | "OTHER" | "EXTERNAL"

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
}

export function paymentMethodLabelForRecord(method: RecordInvoicePaymentMethod): string {
  if (method === "VENMO") return "Venmo"
  if (method === "CASH") return "Cash"
  if (method === "EXTERNAL") return "Paid outside Lyncr"
  return "Other"
}

function defaultPaymentNote(method: RecordInvoicePaymentMethod): string {
  if (method === "VENMO") return "Paid via Venmo"
  if (method === "CASH") return "Paid in cash"
  if (method === "EXTERNAL") return "Paid outside Lyncr"
  return "Paid outside Lyncr"
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

function invoiceNumberFromRecordId(id: string): string {
  const bare = id.replace(/-/g, "").toUpperCase()
  const tail = bare.slice(-8) || bare.slice(0, 8) || "RECEIPT"
  return `INV-${tail}`
}

function parseRecordRow(row: Record<string, unknown>): JobRecordInvoiceRow {
  const methodRaw = String(row.payment_method ?? "VENMO").toUpperCase()
  const paymentMethod: RecordInvoicePaymentMethod =
    methodRaw === "CASH" || methodRaw === "OTHER" || methodRaw === "EXTERNAL"
      ? methodRaw
      : "VENMO"
  return {
    id: String(row.id),
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
  }
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
  const businessPhone = (user?.phone || "").trim() || null
  const appUrl = getAppUrl().replace(/\/$/, "")
  const note = (row.paymentNote || defaultPaymentNote(row.paymentMethod)).trim()
  const service = row.serviceLabel.trim() || "Service"
  const lineLabel = [service, row.vehicleLabel.trim() || null].filter(Boolean).join(" · ")

  return {
    invoiceNumber: invoiceNumberFromRecordId(row.id),
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
    receiptUrl: `${appUrl}/r/${row.receiptToken}`,
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
}

/** Insert a paid-outside invoice row and return it (with receipt token). */
export async function createJobRecordInvoice(
  input: CreateRecordInvoiceInput
): Promise<JobRecordInvoiceRow> {
  const amountCents = Math.max(0, Math.round(Number(input.amountCents) || 0))
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Enter an amount greater than $0")
  }
  const method = input.paymentMethod
  const note =
    (input.paymentNote ?? "").trim() || defaultPaymentNote(method)
  const paidAt =
    input.paidAtIso && !Number.isNaN(Date.parse(input.paidAtIso))
      ? new Date(input.paidAtIso).toISOString()
      : new Date().toISOString()
  const phone = normalizePhoneNumberE164(input.customerPhone ?? "") || ""
  const sql = getSql()

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = makeReceiptToken()
    try {
      const rows = await sql`
        INSERT INTO job_record_invoices (
          id, owner_user_id, customer_id, job_id, amount_cents, payment_method,
          payment_note, customer_name, customer_email, customer_phone,
          service_label, vehicle_label, vehicle_vin, address_line1,
          paid_at, receipt_token, created_at
        ) VALUES (
          gen_random_uuid(),
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
    } catch (e) {
      if (isMissingRecordInvoicesTable(e)) {
        throw new Error(
          "Database needs migration 132 — run scripts/132-job-record-invoices.sql in Neon SQL Editor"
        )
      }
      const msg = e instanceof Error ? e.message : String(e)
      if (/duplicate key|unique/i.test(msg)) continue
      throw e
    }
  }
  throw new Error("Could not create invoice link")
}

function inviteSender(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Lyncr <receipts@lyncr.app>"
}

export type SendRecordInvoiceChannel = "email" | "sms" | "both"

/** Email and/or SMS a record invoice (no Stripe charge required). */
export async function sendJobRecordInvoice(params: {
  userId: string
  invoice: JobRecordInvoiceRow
  channel: SendRecordInvoiceChannel
  email?: string | null
  phone?: string | null
  customerName?: string | null
}): Promise<{ sent: boolean; error?: string; receiptUrl?: string; channels: string[] }> {
  const invoiceModel = await recordInvoiceToPaymentInvoice(params.invoice)
  if ((params.customerName ?? "").trim()) {
    invoiceModel.customerName = params.customerName!.trim()
  }

  const channels: string[] = []
  const wantEmail = params.channel === "email" || params.channel === "both"
  const wantSms = params.channel === "sms" || params.channel === "both"
  let lastError: string | undefined

  if (wantEmail) {
    const email = (params.email ?? params.invoice.customerEmail ?? "").trim().toLowerCase()
    if (!email.includes("@") || email.length < 5) {
      if (params.channel === "email") {
        return { sent: false, error: "Enter a valid email address", channels }
      }
      lastError = "Email skipped — no valid address"
    } else {
      const apiKey = process.env.RESEND_API_KEY?.trim()
      if (!apiKey) {
        if (params.channel === "email") {
          return {
            sent: false,
            error: "Email is not configured (RESEND_API_KEY)",
            channels,
          }
        }
        lastError = "Email skipped — Resend not configured"
      } else {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: inviteSender(),
              to: email,
              subject: `Invoice ${invoiceModel.invoiceNumber} — ${invoiceModel.businessName} — $${(invoiceModel.totalCents / 100).toFixed(2)} paid`,
              html: buildPaymentInvoiceEmailHtml(invoiceModel),
              text: buildPaymentInvoiceEmailText(invoiceModel),
            }),
          })
          if (!res.ok) {
            lastError = "Email could not be sent"
            if (params.channel === "email") {
              return { sent: false, error: lastError, channels }
            }
          } else {
            channels.push("email")
          }
        } catch {
          lastError = "Email send failed"
          if (params.channel === "email") {
            return { sent: false, error: lastError, channels }
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
      if (params.channel === "sms") {
        return { sent: false, error: "Enter a valid phone number", channels }
      }
      lastError = lastError || "SMS skipped — no valid phone"
    } else {
      const text = buildPaymentInvoiceSms(invoiceModel)
      const result = await sendTelnyxSms({
        userId: params.userId,
        toE164,
        text,
      })
      if (!result.ok) {
        lastError = result.error || "SMS could not be sent"
        if (params.channel === "sms") {
          return { sent: false, error: lastError, channels }
        }
      } else {
        channels.push("sms")
      }
    }
  }

  if (channels.length === 0) {
    return {
      sent: false,
      error: lastError || "Could not send invoice",
      channels,
      receiptUrl: invoiceModel.receiptUrl,
    }
  }
  return {
    sent: true,
    channels,
    receiptUrl: invoiceModel.receiptUrl,
    error: lastError,
  }
}
