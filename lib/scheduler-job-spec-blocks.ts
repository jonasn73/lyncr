import { SERVICE_QUOTE_TYPES } from "@/lib/service-quote-calculator"
import { normalizeServiceQuoteTypeId } from "@/lib/service-rate-card"
import { serviceQuoteTypeFromJobType } from "@/lib/job-intake-fields"

export type JobSpecBlock = {
  label: string
  value: string
}

type JobSpecSource = {
  vehicle_year?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  key_frequency?: string | null
  key_style?: string | null
  key_chipset?: string | null
  key_fcc_id?: string | null
  service_quote_type_id?: string | null
  job_type?: string | null
  location?: string | null
}

/** Readable technical spec chips for the scheduler job overview panel. */
export function buildJobTechnicalSpecBlocks(source: JobSpecSource): JobSpecBlock[] {
  const blocks: JobSpecBlock[] = []
  const ymm = [source.vehicle_year, source.vehicle_make, source.vehicle_model]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ")
  if (ymm) blocks.push({ label: "Vehicle", value: ymm })

  const serviceId = source.service_quote_type_id
    ? normalizeServiceQuoteTypeId(source.service_quote_type_id)
    : serviceQuoteTypeFromJobType(source.job_type ?? "")
  const serviceLabel =
    SERVICE_QUOTE_TYPES.find((entry) => entry.id === serviceId)?.label ?? source.job_type?.trim()
  if (serviceLabel) blocks.push({ label: "Service", value: serviceLabel })

  const frequency = (source.key_frequency ?? "").trim()
  const keyStyle = (source.key_style ?? "").trim()
  if (frequency || keyStyle) {
    const freqPart = frequency ? `${frequency} MHz` : ""
    const stylePart = keyStyle && keyStyle !== "Not sure yet" ? keyStyle : ""
    const value = [freqPart, stylePart].filter(Boolean).join(" ")
    if (value) blocks.push({ label: "Key", value })
  }

  const chipset = (source.key_chipset ?? "").trim()
  if (chipset) blocks.push({ label: "Chip", value: chipset })

  const fcc = (source.key_fcc_id ?? "").trim()
  if (fcc) blocks.push({ label: "FCC ID", value: fcc })

  const address = (source.location ?? "").trim()
  if (address) blocks.push({ label: "Address", value: address })

  return blocks
}
