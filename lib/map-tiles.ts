// Shared Leaflet basemap layers — Mapbox dark vector tiles when token is set, else free
// OpenStreetMap raster tiles with a CSS filter approximating the dark theme.
//
// CARTO's old free basemaps.cartocdn.com raster tiles (the previous fallback here) now
// serve a literal "API KEY REQUIRED" placeholder image on cache-miss tiles instead of real
// map data — CARTO locked that free tier down. OSM's own tile server has no such gate.

import type { Map as LeafletMap } from "leaflet"

type LeafletModule = typeof import("leaflet")

/** Read Mapbox token from public env (supports legacy NEXT_PUBLIC_MAP_TOKEN alias). */
function mapboxAccessToken(): string | null {
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

  // Free OSM raster tiles, inverted via CSS (leaflet-popup-overrides.css) to a dark theme —
  // no key, no account, no CDN paywall.
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: "abc",
    maxZoom: 19,
    className: "lyncr-osm-dark-tiles",
  }).addTo(map)
}
