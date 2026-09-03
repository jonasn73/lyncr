"use client"

// Key photo with a shape-accurate fallback illustration when there's no photo (or it fails
// to load) — shared by the owner/receptionist desktop key catalog
// (components/vehicle-key-info-panel.tsx) and the tech console's Key Lookup
// (components/tech/tech-key-lookup.tsx). Split into its own file so importing it doesn't
// pull the whole desktop intake panel's module graph into the tech console's bundle.

import { useState } from "react"
import { isVolvoInsertFobikVehicle, isVolvoKeyVol05OptionId } from "@/lib/fcc-id-input"
import { stripTiSkuPrefix } from "@/lib/transponder-island-sku"

export type KeyIllustrationKind = "proximity" | "high_security" | "transponder" | "volvo_fobik"

/** True when key type / SKU looks like a prox / smart / fob (not a metal blade). */
export function isSmartOrProxKeyType(label: string, variantId?: string | null, tiSku?: string | null): boolean {
  const blob = `${label} ${variantId ?? ""} ${tiSku ?? ""}`.toLowerCase()
  return (
    /proximity|smart\s*key|push.?start|\bprox\b|\bfob\b|keyless|tik-sub-|prox-sub|prox-hon|prox-toy/.test(
      blob
    ) || stripTiSkuPrefix(tiSku).startsWith("PROX-")
  )
}

/** Pick a sample illustration from the card label / variant id when no photo exists. */
function classifyKeyIllustration(
  label: string,
  variantId?: string | null,
  make?: string | null,
  model?: string | null,
  tiSku?: string | null
): KeyIllustrationKind {
  const blob = `${label} ${variantId ?? ""} ${tiSku ?? ""}`.toLowerCase()
  // KEY-VOL-05 insert-to-start / legacy Fobik id → Volvo Fobik silhouette.
  if (
    variantId === "KEY-VOL-05-NONPROX" ||
    variantId === "volvo-fobik-5b" ||
    /insert.?to.?start|nonprox|volvo.*fobik|fobik.*5|5.?button.?fobik/.test(blob)
  ) {
    return "volvo_fobik"
  }
  // Prox / smart / fob → modern smart-key outline (not a physical blade).
  if (
    variantId === "KEY-VOL-05-PROX" ||
    (isVolvoKeyVol05OptionId(variantId) && /prox/.test(blob)) ||
    isSmartOrProxKeyType(label, variantId, tiSku)
  ) {
    return "proximity"
  }
  if (/high.?security|edge.?cut|laser|flip.?blade|mechanical|\bblade\b/.test(blob)) {
    return "high_security"
  }
  if (/transponder|remote.?head|315|433|standard/.test(blob)) return "transponder"
  // Classic Volvo KEY-VOL-05 models in bypass: default sample to the insert Fobik.
  if (make && model && isVolvoInsertFobikVehicle(make, model)) return "volvo_fobik"
  return "transponder"
}

/** Modern rectangular proximity / smart fob with chrome-style border. */
function ProximitySmartKeySvg() {
  return (
    <svg viewBox="0 0 120 72" className="h-14 w-auto" aria-hidden>
      <rect x="18" y="8" width="84" height="56" rx="10" fill="#0f172a" stroke="#94a3b8" strokeWidth="2.5" />
      <rect x="24" y="14" width="72" height="44" rx="7" fill="#1e293b" stroke="#cbd5e1" strokeWidth="1.25" />
      <circle cx="60" cy="30" r="7" fill="none" stroke="#64748b" strokeWidth="1.5" />
      <circle cx="60" cy="30" r="2.5" fill="#94a3b8" />
      <rect x="42" y="44" width="12" height="6" rx="2" fill="#334155" />
      <rect x="58" y="44" width="12" height="6" rx="2" fill="#334155" />
      <rect x="74" y="44" width="8" height="6" rx="2" fill="#475569" />
    </svg>
  )
}

/** Physical flip / laser-cut blade key profile. */
function HighSecurityBladeKeySvg() {
  return (
    <svg viewBox="0 0 140 56" className="h-11 w-auto" aria-hidden>
      <path
        d="M18 28c0-9 7-16 16-16h22c3 0 5 2 5 5v22c0 3-2 5-5 5H34c-9 0-16-7-16-16z"
        fill="#1e293b"
        stroke="#94a3b8"
        strokeWidth="2"
      />
      <circle cx="30" cy="28" r="5" fill="#0f172a" stroke="#64748b" strokeWidth="1.5" />
      <path d="M61 22h58l6 6v8l-6 6H61V22z" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.25" />
      <path d="M72 28h8M84 28h6M94 28h8M106 28h5" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
      <path d="M78 34h10M92 34h8M104 34h6" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Traditional plastic-headed transponder / remote-head key. */
function StandardTransponderKeySvg() {
  return (
    <svg viewBox="0 0 140 64" className="h-14 w-auto" aria-hidden>
      <rect x="14" y="10" width="48" height="44" rx="8" fill="#1e293b" stroke="#94a3b8" strokeWidth="2" />
      <circle cx="30" cy="32" r="6" fill="#0f172a" stroke="#64748b" strokeWidth="1.5" />
      <rect x="42" y="20" width="12" height="8" rx="2" fill="#334155" />
      <rect x="42" y="32" width="12" height="8" rx="2" fill="#334155" />
      <rect x="42" y="44" width="12" height="5" rx="1.5" fill="#475569" />
      <path d="M62 28h52v8H62z" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.25" />
      <path d="M74 28v-4M86 28v-5M98 28v-3M110 28v-4" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
      <path d="M74 36v3M86 36v4M98 36v2M110 36v3" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Volvo 5-button insert Fobik — vertical body, squared plastic insert shaft on top,
 * Lock / Unlock / Lights / Trunk grid + red panic triangle at the bottom.
 */
function VolvoFobik5ButtonSvg() {
  return (
    <svg viewBox="0 0 72 130" className="h-28 w-auto" aria-hidden>
      {/* Protruding square plastic insert shaft (blade) at the top */}
      <rect x="26" y="2" width="20" height="16" rx="2" fill="#94a3b8" stroke="#64748b" strokeWidth="1.25" />
      <rect x="30" y="5" width="12" height="10" rx="1" fill="#cbd5e1" />
      {/* Vertical rectangular body with a rounded bottom */}
      <path
        d="M16 18h40c4 0 8 4 8 8v60c0 16-12 28-28 28S8 102 8 86V26c0-4 4-8 8-8z"
        fill="#1e293b"
        stroke="#94a3b8"
        strokeWidth="2"
      />
      {/* Inner face plate */}
      <path
        d="M20 24h32c2.5 0 5 2.5 5 5v54c0 12-9 22-21 22S15 95 15 83V29c0-2.5 2.5-5 5-5z"
        fill="#0f172a"
        stroke="#475569"
        strokeWidth="1"
      />
      {/* 2×2 grid: Lock, Unlock, Lights, Trunk */}
      <rect x="24" y="32" width="10" height="10" rx="1.5" fill="#334155" stroke="#64748b" strokeWidth="0.75" />
      <rect x="38" y="32" width="10" height="10" rx="1.5" fill="#334155" stroke="#64748b" strokeWidth="0.75" />
      <rect x="24" y="46" width="10" height="10" rx="1.5" fill="#334155" stroke="#64748b" strokeWidth="0.75" />
      <rect x="38" y="46" width="10" height="10" rx="1.5" fill="#334155" stroke="#64748b" strokeWidth="0.75" />
      {/* Tiny lock / unlock glyphs */}
      <circle cx="29" cy="36" r="1.6" fill="none" stroke="#94a3b8" strokeWidth="0.9" />
      <rect x="27.5" y="37.2" width="3" height="2.5" rx="0.4" fill="#94a3b8" />
      <path d="M40.5 36.5h5M43 34v5" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" />
      {/* Lights + trunk glyphs */}
      <circle cx="29" cy="51" r="2.2" fill="none" stroke="#94a3b8" strokeWidth="0.9" />
      <path d="M29 48.2v-1.2M26.5 49.2l-.9-.9M31.5 49.2l.9-.9" stroke="#94a3b8" strokeWidth="0.7" />
      <path d="M40 52h6v2.5h-6zM41 50.5h4l.8 1.5h-5.6z" fill="#94a3b8" />
      {/* Red warning-triangle panic button at the bottom */}
      <path d="M36 78 L44 92 L28 92 Z" fill="#ef4444" stroke="#fca5a5" strokeWidth="1" strokeLinejoin="round" />
      <rect x="35.2" y="82" width="1.6" height="5" rx="0.4" fill="#fff" />
      <circle cx="36" cy="89.2" r="0.9" fill="#fff" />
    </svg>
  )
}

function KeyTypeSampleIllustration({ kind }: { kind: KeyIllustrationKind }) {
  if (kind === "proximity") return <ProximitySmartKeySvg />
  if (kind === "high_security") return <HighSecurityBladeKeySvg />
  if (kind === "volvo_fobik") return <VolvoFobik5ButtonSvg />
  return <StandardTransponderKeySvg />
}

export function KeyThumbnail({
  imageUrl,
  label,
  variantId,
  make,
  model,
  tiSku,
}: {
  imageUrl: string | null
  label: string
  variantId?: string | null
  make?: string | null
  model?: string | null
  tiSku?: string | null
}) {
  const [failed, setFailed] = useState(false)
  const illustrationKind = classifyKeyIllustration(label, variantId, make, model, tiSku)
  // Prefer the smart-fob outline for prox/smart/fob keys; photos still win when they load.
  const forceFobOutline = illustrationKind === "proximity" && (!imageUrl || failed)
  const showImage = Boolean(imageUrl) && !failed && !forceFobOutline

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex h-32 items-center justify-center">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- fccid.io / bundled key thumbnails
          <img
            src={imageUrl!}
            alt={label}
            loading="lazy"
            className="h-full w-full object-contain p-2"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-2 text-muted-foreground">
            <KeyTypeSampleIllustration kind={illustrationKind} />
            <span className="sr-only">{label} layout sample</span>
          </div>
        )}
      </div>
      {!showImage ? (
        <p className="border-t border-border/80 px-2 py-2 text-center text-2xs leading-snug text-muted-foreground">
          Verify button configuration with customer to confirm selection.
        </p>
      ) : null}
    </div>
  )
}
