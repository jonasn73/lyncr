// Shared key style labels for intake photo cards (client + server safe).

export type KeyStyleBucket = "smart" | "remote_head" | "flip" | "keyless_fob" | "turn_key" | "other"

/** Group a listing into a physical key style bucket for picking + labels. */
export function classifyKeyStyleBucket(title: string, keyType: string | null): KeyStyleBucket {
  const blob = `${keyType ?? ""} ${title}`.toLowerCase()
  if (/diy kit|voice fob|programmer|\bobd\b|\btool\b/.test(blob)) return "other"
  if (/flip\s*key|remote flip/.test(blob)) return "flip"
  if (/remote head|key combo|combo key|remote\/key combo/.test(blob)) return "remote_head"
  if (/smart|proximity|push\s*start|keyless go/.test(blob)) return "smart"
  if (/keyless entry remote|keyless remote|remote key fob|remote fob/.test(blob) && !/combo|head|blade/.test(blob)) {
    return "keyless_fob"
  }
  if (/blade|turn key|mechanical key/.test(blob)) return "turn_key"
  if (keyType?.toLowerCase().includes("smart")) return "smart"
  return "other"
}

/** Short card label shown under each key photo. */
export function variantDisplayLabel(title: string, keyType: string | null): string {
  switch (classifyKeyStyleBucket(title, keyType)) {
    case "smart":
      return "Smart key"
    case "remote_head":
      return "Remote head key"
    case "flip":
      return "Flip key"
    case "keyless_fob":
      return "Keyless fob"
    case "turn_key":
      return "Turn key"
    default:
      if (/remote|fob/.test(title.toLowerCase())) return "Remote key"
      return "Key"
  }
}

/** Pull button count from supplier titles like "4-Button", "4 Button", or Ford "3B". */
export function extractButtonCount(
  title: string,
  buttons: string | null,
  fitsText?: string | null
): string | null {
  const blob = `${title} ${buttons ?? ""} ${fitsText ?? ""}`.toLowerCase()
  const standard = blob.match(/(\d)\s*[- ]?button/)
  if (standard) return standard[1]!
  const fordShort = blob.match(/\b(\d)\s*b\b/)
  if (fordShort) return fordShort[1]!
  return null
}

/** Human label for button layout, e.g. "4-button + trunk" or "Smart key + trunk". */
export function variantButtonLabel(
  title: string,
  buttons: string | null,
  fitsText?: string | null,
  keyType?: string | null
): string | null {
  const blob = `${title} ${buttons ?? ""} ${fitsText ?? ""}`.toLowerCase()
  const count = extractButtonCount(title, buttons, fitsText)
  if (count) {
    const parts = [`${count}-button`]
    if (/remote start|engine start|push start/.test(blob)) parts.push("remote start")
    if (/trunk|liftgate|hatch|w\/\s*trunk/.test(blob)) parts.push("trunk")
    if (/panic/.test(blob)) parts.push("panic")
    return parts.join(" + ")
  }

  if (classifyKeyStyleBucket(title, keyType ?? null) === "smart") {
    const features: string[] = []
    if (/remote start|engine start|push start/.test(blob)) features.push("remote start")
    if (/trunk|liftgate|hatch|w\/\s*trunk/.test(blob)) features.push("trunk")
    if (/panic/.test(blob)) features.push("panic")
    if (features.length > 0) return `Smart key + ${features.join(" + ")}`
  }

  return null
}

/** Stable signature so we pick one photo per distinct button layout. */
export function variantButtonSignature(
  title: string,
  buttons: string | null,
  fitsText?: string | null,
  keyType?: string | null
): string {
  const blob = `${title} ${buttons ?? ""} ${fitsText ?? ""}`.toLowerCase()
  const count = extractButtonCount(title, buttons, fitsText)
  let countToken = count ?? "?"
  if (!count && classifyKeyStyleBucket(title, keyType ?? null) === "smart") {
    countToken = "smart"
  }
  const features: string[] = []
  if (/trunk|liftgate|hatch|w\/\s*trunk/.test(blob)) features.push("trunk")
  if (/panic/.test(blob)) features.push("panic")
  if (/remote start|engine start|push start/.test(blob)) features.push("start")
  return `${countToken}|${features.sort().join(",")}`
}

/** Map listing metadata to a dispatcher-facing programming method badge. */
export function inferProgrammingMethod(
  title: string,
  keyType: string | null,
  chipset?: string | null
): string {
  const blob = `${title} ${keyType ?? ""} ${chipset ?? ""}`.toLowerCase()
  if (/on.?board|manual sequence|dealer tool|pin code/.test(blob)) return "On-Board Sequence"
  if (/blade|turn key|mechanical|high.?security|edge cut|laser/.test(blob)) return "On-Board Sequence"
  if (/smart|proximity|push\s*start|keyless go|transponder|immobilizer|remote head|combo/.test(blob)) {
    return "OBD2 Programming Required"
  }
  if (/remote|fob|keyless/.test(blob)) return "OBD2 Programming Required"
  return "OBD2 Bypass Required"
}

/** Map a variant bucket to the intake form key-style dropdown value. */
export function bucketToKeyStyleOption(bucket: KeyStyleBucket): string | null {
  switch (bucket) {
    case "smart":
      return "Push start (smart key)"
    case "remote_head":
      return "Remote head key"
    case "flip":
      return "Flip key"
    case "keyless_fob":
      return "Keyless remote only"
    case "turn_key":
      return "Turn key (blade)"
    default:
      return null
  }
}

export function resolveVariantKeyStyle(
  title: string,
  keyType: string | null,
  suggested: string | null,
  currentStyle: string,
  keyStyleOptions: readonly string[]
): string {
  if (suggested && keyStyleOptions.includes(suggested)) return suggested
  const fromBucket = bucketToKeyStyleOption(classifyKeyStyleBucket(title, keyType))
  if (fromBucket && keyStyleOptions.includes(fromBucket)) return fromBucket
  if (currentStyle && currentStyle !== "Not sure yet") return currentStyle
  return "Not sure yet"
}
