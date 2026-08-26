// ============================================
// Separating parts from labor on a job
// ============================================
// Commissioning the gross when the business supplies the parts pays the worker a
// percentage of inventory the business already bought. A $200 job carrying $60 of key
// stock is $140 of labor, and that is the number a labor commission should apply to.
//
// The split already exists at quote time — calculateServiceQuote emits a `key_blank`
// line for the blank or fob and treats programming, travel and the base rate as work.
// That breakdown is persisted on ai_leads.collected.pricing_metadata, so booked jobs
// need no new column. On-site invoices raised by a tech carry an optional `kind` per
// line instead, defaulting to labor when nobody said otherwise.

/** Quote line kinds that are hardware the business paid for, not work performed. */
const PARTS_LINE_KINDS = new Set(["key_blank"])

/** Line-item kinds a tech can mark on an on-site invoice. */
export type InvoiceLineKind = "labor" | "part"

export interface JobPartsSplit {
  /** Hardware cost inside the job, in cents. */
  partsCents: number
  /** How the number was arrived at. */
  source: "pricing_metadata" | "invoice_line_items" | "none"
  /**
   * True when nothing distinguished parts from labor, so partsCents is zero because
   * it is unknown — not because the job had no parts. Callers must not present a
   * labor figure derived from this as exact.
   */
  unknown: boolean
}

const UNKNOWN: JobPartsSplit = { partsCents: 0, source: "none", unknown: true }

function toCents(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * Parts cost from a persisted quote breakdown.
 *
 * `collected.pricing_metadata.lines` is written at booking with a `kind` per line;
 * anything tagged as hardware counts, everything else is work.
 */
export function partsFromPricingMetadata(collected: unknown): JobPartsSplit {
  if (!collected || typeof collected !== "object") return UNKNOWN
  const metadata = (collected as Record<string, unknown>).pricing_metadata
  if (!metadata || typeof metadata !== "object") return UNKNOWN
  const lines = (metadata as Record<string, unknown>).lines
  if (!Array.isArray(lines) || lines.length === 0) return UNKNOWN

  let partsCents = 0
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue
    const line = raw as Record<string, unknown>
    const kind = String(line.kind ?? "").trim().toLowerCase()
    if (PARTS_LINE_KINDS.has(kind)) partsCents += toCents(line.cents)
  }
  // A breakdown that lists no hardware line is a job with no parts — that is a real
  // answer, not a missing one, so this is not `unknown`.
  return { partsCents, source: "pricing_metadata", unknown: false }
}

/**
 * Parts cost from an on-site invoice.
 *
 * Lines carry an optional `kind`. A line with none is treated as labor — the tech did
 * not say it was a part, and guessing from the label would quietly move money.
 * Returns unknown when no line was classified at all, so the caller can tell
 * "no parts on this job" from "nobody told us".
 */
export function partsFromInvoiceLineItems(lineItems: unknown): JobPartsSplit {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return UNKNOWN

  let partsCents = 0
  let anyClassified = false
  for (const raw of lineItems) {
    if (!raw || typeof raw !== "object") continue
    const line = raw as Record<string, unknown>
    const kind = String(line.kind ?? "").trim().toLowerCase()
    if (kind === "part" || kind === "labor") anyClassified = true
    if (kind === "part") partsCents += toCents(line.amount_cents)
  }

  if (!anyClassified) return UNKNOWN
  return { partsCents, source: "invoice_line_items", unknown: false }
}

/**
 * Labor value of a job — the subtotal with hardware taken out.
 *
 * Parts come out at full cost even when the job was discounted: a key blank cost what
 * it cost regardless of what the customer was eventually charged. Floored at zero so a
 * job discounted below its parts cost cannot produce a negative commission base.
 */
export function laborCentsFrom(subtotalCents: number, split: JobPartsSplit): number {
  const subtotal = Math.max(0, Math.round(subtotalCents))
  if (split.unknown) return subtotal
  return Math.max(0, subtotal - Math.max(0, split.partsCents))
}
