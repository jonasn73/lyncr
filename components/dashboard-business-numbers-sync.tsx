"use client"

import { useEffect, useRef } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import {
  resolveActiveLineAfterNumbers,
  useBusinessNumbersQuery,
} from "@/lib/hooks/use-business-numbers-query"
import type { DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"

function numbersUnchanged(a: DashboardBusinessNumber[], b: DashboardBusinessNumber[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((row, i) => row.number === b[i]?.number && row.status === b[i]?.status)
}

/** Keeps workspace context in sync with the SWR business-numbers cache. */
export function DashboardBusinessNumbersSync() {
  const {
    activeOrganizationId,
    setBusinessNumbers,
    setBusinessNumbersLoading,
    activeLine,
    setActiveLine,
  } = useDashboardWorkspace()

  const bootstrap = useDashboardBootstrapEffective()
  const { phoneLinesPromise, dashboardMainBootstrapPromise } = useDashboardStream()
  const skipNumbersFetch = Boolean(bootstrap || dashboardMainBootstrapPromise)
  const { numbers, reservedNumber, isLoading, mutate } = useBusinessNumbersQuery(activeOrganizationId, {
    skipInitialFetch: skipNumbersFetch,
  })
  const prevNumbersRef = useRef(numbers)

  useEffect(() => {
    if (bootstrap) return
    if (numbersUnchanged(prevNumbersRef.current, numbers)) return
    prevNumbersRef.current = numbers
    setBusinessNumbers(numbers)
  }, [bootstrap, numbers, setBusinessNumbers])

  useEffect(() => {
    if (bootstrap) {
      setBusinessNumbersLoading(false)
      return
    }
    if (dashboardMainBootstrapPromise) {
      if (!isLoading) setBusinessNumbersLoading(false)
      return
    }
    if (phoneLinesPromise) {
      if (!isLoading) setBusinessNumbersLoading(false)
      return
    }
    setBusinessNumbersLoading(isLoading)
  }, [bootstrap, dashboardMainBootstrapPromise, isLoading, phoneLinesPromise, setBusinessNumbersLoading])

  useEffect(() => {
    if (bootstrap) return
    const next = resolveActiveLineAfterNumbers(numbers, reservedNumber, activeLine)
    if (next !== activeLine) setActiveLine(next)
  }, [bootstrap, numbers, reservedNumber, activeLine, setActiveLine])

  useEffect(() => {
    const onChanged = () => {
      void mutate()
    }
    window.addEventListener("zing-business-numbers-changed", onChanged)
    return () => window.removeEventListener("zing-business-numbers-changed", onChanged)
  }, [mutate])

  return null
}
