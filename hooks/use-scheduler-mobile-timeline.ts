"use client"

import { useLayoutEffect, useState } from "react"
import { useIsMobile } from "@/hooks/use-mobile"

/** True when the horizontal timeline (`md:hidden`) is shown — same breakpoint as Tailwind `md`. */
export function useSchedulerMobileTimeline(): boolean {
  return useIsMobile()
}

function readCoarsePointer(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.matchMedia("(pointer: coarse)").matches
  } catch {
    return false
  }
}

/** True on touch/coarse pointers — drag-and-drop is disabled to avoid scroll conflicts. */
export function useSchedulerTouchInteraction(): boolean {
  const mobileTimeline = useSchedulerMobileTimeline()
  // Seed from real pointer media — never from viewport width (that flipped card chrome after paint).
  const [coarsePointer, setCoarsePointer] = useState(readCoarsePointer)

  useLayoutEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)")
    const update = () => setCoarsePointer(mql.matches)
    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [])

  return mobileTimeline || coarsePointer
}
