// Build a downloadable Letter-size PDF for a paid invoice / receipt.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import type { PaymentInvoice } from "@/lib/payment-invoice"
import { formatInvoiceMoney } from "@/lib/payment-invoice"

/** Safe filename stem from invoice number (e.g. INV-3F2A9C1B.pdf). */
export function invoicePdfFilename(invoice: PaymentInvoice): string {
  const stem = invoice.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, "") || "invoice"
  return `${stem}.pdf`
}

/** Generate a clean one-page PDF the customer can save on mobile. */
export async function buildPaymentInvoicePdf(
  invoice: PaymentInvoice
): Promise<Uint8Array> {
  // Create a blank US Letter page (612 × 792 points).
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  const ink = rgb(0.06, 0.09, 0.16)
  const muted = rgb(0.45, 0.51, 0.58)
  const paidGreen = rgb(0.02, 0.59, 0.41)
  const lineGray = rgb(0.88, 0.91, 0.94)

  let y = 742
  const left = 48
  const right = 564
  const width = right - left

  const drawText = (
    text: string,
    x: number,
    yy: number,
    size: number,
    bold = false,
    color = ink
  ) => {
    page.drawText(text, {
      x,
      y: yy,
      size,
      font: bold ? fontBold : font,
      color,
    })
  }

  // Header — business name is the hero.
  drawText("INVOICE / RECEIPT", left, y, 10, true, muted)
  y -= 22
  drawText(invoice.businessName.slice(0, 48), left, y, 20, true)
  y -= 16
  if (invoice.businessPhone) {
    drawText(invoice.businessPhone, left, y, 11, false, muted)
    y -= 14
  }

  // PAID badge (right side of header).
  const badge = "PAID"
  const badgeSize = 14
  const badgeW = fontBold.widthOfTextAtSize(badge, badgeSize) + 20
  const badgeH = 26
  const badgeX = right - badgeW
  const badgeY = 720
  page.drawRectangle({
    x: badgeX,
    y: badgeY,
    width: badgeW,
    height: badgeH,
    color: rgb(0.91, 0.98, 0.95),
    borderColor: paidGreen,
    borderWidth: 1.5,
  })
  drawText(badge, badgeX + 10, badgeY + 7, badgeSize, true, paidGreen)

  y -= 18
  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1.5,
    color: ink,
  })
  y -= 28

  // Meta rows.
  const meta: Array<[string, string]> = [
    ["Invoice #", invoice.invoiceNumber],
    ["Date paid", invoice.paidAtLabel],
    ["Payment", invoice.paymentMethodLabel],
  ]
  if (invoice.paidNote?.trim()) {
    meta.push(["Paid note", invoice.paidNote.trim()])
  }
  if (invoice.customerName?.trim()) {
    meta.push(["Bill to", invoice.customerName.trim()])
  }
  if (invoice.vehicleLabel?.trim()) {
    meta.push(["Vehicle", invoice.vehicleLabel.trim()])
  }
  if (invoice.vehicleVin?.trim()) {
    meta.push(["VIN", invoice.vehicleVin.trim()])
  }
  if (invoice.addressLine1?.trim()) {
    meta.push(["Address", invoice.addressLine1.trim()])
  }

  for (const [label, value] of meta) {
    drawText(label.toUpperCase(), left, y, 8, true, muted)
    const valueText = value.slice(0, 70)
    const vw = font.widthOfTextAtSize(valueText, 11)
    drawText(valueText, right - vw, y - 1, 11)
    y -= 20
  }

  y -= 8
  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1,
    color: lineGray,
  })
  y -= 22

  // Line items header.
  drawText("DESCRIPTION", left, y, 8, true, muted)
  drawText("AMOUNT", right - fontBold.widthOfTextAtSize("AMOUNT", 8), y, 8, true, muted)
  y -= 14
  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 0.75,
    color: lineGray,
  })
  y -= 18

  for (const line of invoice.lines) {
    const label = line.label.slice(0, 55)
    const amount = formatInvoiceMoney(line.amountCents)
    drawText(label, left, y, 11)
    drawText(amount, right - font.widthOfTextAtSize(amount, 11), y, 11)
    y -= 20
  }

  y -= 6
  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1.5,
    color: ink,
  })
  y -= 24

  const totalLabel = "Total paid"
  const totalAmt = formatInvoiceMoney(invoice.totalCents)
  drawText(totalLabel, left, y, 14, true)
  drawText(totalAmt, right - fontBold.widthOfTextAtSize(totalAmt, 14), y, 14, true, paidGreen)

  y -= 36
  const footer = "This is a paid invoice. Keep it for your records."
  drawText(footer.slice(0, 90), left, y, 9, false, muted)
  y -= 16
  drawText(`View online: ${invoice.receiptUrl}`.slice(0, 95), left, y, 8, false, muted)

  // Bottom credit — small, not overpowering the business brand.
  drawText("Powered by Lyncr", left, 36, 8, false, muted)

  // Unused width keeps TypeScript happy if we tweak layout later.
  void width

  return doc.save()
}
