// Trim / factory-option cross-checks for key variant cards (client + server safe).

export type VehicleFactoryOption =
  | "remote_start"
  | "power_liftgate"
  | "proximity_entry"
  | "push_button_start"

export type VehicleTrimProfile = {
  /** Trim name from VIN decode or dispatcher selection (e.g. Base, SLT). */
  trim?: string | null
  /** Factory features confirmed equipped on this vehicle. */
  factoryOptions?: VehicleFactoryOption[]
  /** Factory features confirmed absent on this trim. */
  excludedOptions?: VehicleFactoryOption[]
}

type VariantFeatureSource = {
  title: string
  buttons?: string | null
  fits_text?: string | null
  key_type?: string | null
}

/** Pull factory feature requirements from FCC variant listing text. */
export function extractVariantFactoryFeatures(source: VariantFeatureSource): VehicleFactoryOption[] {
  const blob = `${source.title} ${source.buttons ?? ""} ${source.fits_text ?? ""} ${source.key_type ?? ""}`.toLowerCase()
  const features: VehicleFactoryOption[] = []
  if (/remote start|engine start|push start|2-way start/.test(blob)) features.push("remote_start")
  if (/power liftgate|hands[- ]?free liftgate|power hatch|power trunk/.test(blob)) features.push("power_liftgate")
  if (/proximity|smart key|keyless go|push button start|push-to-start/.test(blob)) {
    features.push("proximity_entry")
    if (/push button start|push-to-start|push start/.test(blob)) features.push("push_button_start")
  }
  return [...new Set(features)]
}

export function isBaseTrimName(trim: string | null | undefined): boolean {
  const normalized = (trim ?? "").trim().toLowerCase()
  if (!normalized) return false
  return /^(base|strip|standard|work truck|wt|l|ls|le|s|se)\b/.test(normalized) || /\bbase\b/.test(normalized)
}

function featureConfirmedPresent(profile: VehicleTrimProfile, feature: VehicleFactoryOption): boolean {
  return (profile.factoryOptions ?? []).includes(feature)
}

function featureConfirmedAbsent(profile: VehicleTrimProfile, feature: VehicleFactoryOption): boolean {
  if ((profile.excludedOptions ?? []).includes(feature)) return true
  const trim = (profile.trim ?? "").trim()
  if (!trim) return false
  if (isBaseTrimName(trim) && !featureConfirmedPresent(profile, feature)) {
    if (feature === "remote_start" || feature === "power_liftgate") return true
  }
  return false
}

/** Disable a variant card when trim data proves the vehicle lacks a required factory feature. */
export function variantDisabledByTrim(
  source: VariantFeatureSource,
  profile: VehicleTrimProfile
): { disabled: boolean; missingFeature: VehicleFactoryOption | null } {
  const required = extractVariantFactoryFeatures(source)
  for (const feature of required) {
    if (featureConfirmedAbsent(profile, feature)) {
      return { disabled: true, missingFeature: feature }
    }
  }
  return { disabled: false, missingFeature: null }
}

/** AKL jobs: warn when a risky variant is picked without trim confirmation. */
export function shouldShowAklTrimVerificationBanner(
  source: VariantFeatureSource,
  profile: VehicleTrimProfile,
  isAllKeysLost: boolean
): boolean {
  if (!isAllKeysLost) return false
  const required = extractVariantFactoryFeatures(source)
  const risky = required.filter((f) => f === "remote_start" || f === "power_liftgate")
  if (risky.length === 0) return false
  return risky.some((feature) => !featureConfirmedPresent(profile, feature))
}

/** Intake saved with uncertain key style — tech must verify before cutting. */
export function keyStyleRequiresFieldVerification(keyStyle: string | null | undefined): boolean {
  const style = (keyStyle ?? "").trim()
  return !style || style === "Not sure yet"
}
