"use client"

import { useEffect, useState } from "react"
import { useIsMobile } from "@/hooks/use-mobile"

/** True when the horizontal timeline (`md:hidden`) is shown — same breakpoint as Tailwind `md`. */
export function useSchedulerMobileTimeline(): boolean {
  return useIsMobile()
}

/** True on touch/coarse pointers — drag-and-drop is disabled to avoid scroll conflicts. */
export function useSchedulerTouchInteraction(): boolean {
  const mobileTimeline = useSchedulerMobileTimeline()
  const [coarsePointer, setCoarsePointer] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)")
    const update = () => setCoarsePointer(mql.matches)
    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [])

  return mobileTimeline || coarsePointer
}
