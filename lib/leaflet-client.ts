// Safe dynamic Leaflet loader for client-only map components.

type LeafletModule = typeof import("leaflet")

/** Load Leaflet in the browser (handles ESM/CJS default export differences). */
export async function loadLeafletClient(): Promise<LeafletModule> {
  const mod = await import("leaflet")
  const L = (mod as { default?: LeafletModule }).default ?? (mod as LeafletModule)
  if (!L || typeof L.map !== "function") {
    throw new Error("Leaflet failed to load")
  }
  return L
}
