// Shared Leaflet basemap layers — Mapbox dark vector tiles when token is set, CARTO dark fallback.

import type { Map as LeafletMap } from "leaflet"

type LeafletModule = typeof import("leaflet")

/** Read Mapbox token from public env (supports legacy NEXT_PUBLIC_MAP_TOKEN alias). */
export function mapboxAccessToken(): string | null {
  if (typeof window !== "undefined") {
    return (
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ||
      process.env.NEXT_PUBLIC_MAP_TOKEN?.trim() ||
      null
    )
  }
  return (
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_MAP_TOKEN?.trim() ||
    null
  )
}

/** Attach premium dark Mapbox tiles or a reliable CARTO dark raster fallback. */
export function attachBaseMapTiles(L: LeafletModule, map: LeafletMap): void {
  const token = mapboxAccessToken()
  if (token) {
    L.tileLayer(
      `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`,
      {
        attribution: '© <a href="https://www.mapbox.com/">Mapbox</a> © OpenStreetMap',
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 20,
      }
    ).addTo(map)
    return
  }

  // CARTO dark — omit {r} retina suffix (can render black tiles on some DPI / CDN paths).
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", {
    attribution: '© OpenStreetMap © <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map)
}
