import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearSharedDispatchMapView,
  getSharedDispatchMapView,
  setSharedDispatchMapView,
} from "@/lib/dispatch-map-view"

describe("dispatch map camera persist", () => {
  const store: Record<string, string> = {}

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k])
    const mock = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k])
      },
    }
    vi.stubGlobal("window", { sessionStorage: mock })
    vi.stubGlobal("sessionStorage", mock)
  })

  afterEach(() => {
    clearSharedDispatchMapView()
    vi.unstubAllGlobals()
  })

  it("saves camera to sessionStorage so a refresh can restore it", () => {
    setSharedDispatchMapView([38.25, -85.76], 12)
    expect(JSON.parse(store.lyncr_dispatch_map_view || "{}")).toEqual({
      center: [38.25, -85.76],
      zoom: 12,
    })
  })

  it("ignores garbage in sessionStorage", () => {
    store.lyncr_dispatch_map_view = "{not-json"
    expect(getSharedDispatchMapView()).toBeNull()
  })
})
