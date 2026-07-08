"use client"

import { useEffect, useState } from "react"
import { findNearestTechMatch, type NearestTechMatch } from "@/lib/nearest-tech-match"
import type { TechLiveLocation } from "@/lib/types"

type NearestTechMatchState = {
  match: NearestTechMatch | null
  loading: boolean
}

/** When a geocoded service address is set, find the closest live field tech. */
export function useNearestTechMatch(jobLat: number | null, jobLng: number | null): NearestTechMatchState {
  const [match, setMatch] = useState<NearestTechMatch | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (jobLat == null || jobLng == null) {
      setMatch(null)
      setLoading(false)
      return
    }

    let cancel = false
    setLoading(true)

    void fetch("/api/owner/jobs", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { data: { techLocations: [] } }))
      .then((json: { data?: { techLocations?: TechLiveLocation[] } }) => {
        if (cancel) return
        const techLocations = Array.isArray(json.data?.techLocations) ? json.data!.techLocations! : []
        setMatch(findNearestTechMatch(jobLat, jobLng, techLocations))
      })
      .catch(() => {
        if (!cancel) setMatch(null)
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })

    return () => {
      cancel = true
    }
  }, [jobLat, jobLng])

  return { match, loading }
}
