"use client"

import { useEffect, useRef } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import { useDashboardBootstrapEffective } from "@/components/dashboard-bootstrap-context"
import { useDashboardStream } from "@/components/dashboard-stream-context"
import {
  resolveActiveLineAfterNumbers,
  useBusinessNumbersQuery,
} from "@/lib/hooks/use-business-numbers-query"
import { businessNumbersMatch, type DashboardBusinessNumber } from "@/lib/dashboard-routing-utils"
import { isWorkspaceOrgStubId } from "@/lib/workspace-organizations"

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
  const hasBootstrap = bootstrap != null
  const { phoneLinesPromise, dashboardMainBootstrapPromise } = useDashboardStream()
  const skipNumbersFetch = Boolean(hasBootstrap || dashboardMainBootstrapPromise)
  const { numbers, reservedNumber, isLoading, mutate } = useBusinessNumbersQuery(activeOrganizationId, {
    skipInitialFetch: skipNumbersFetch,
  })
  const prevNumbersRef = useRef(numbers)

  useEffect(() => {
    if (hasBootstrap) return
    // Keep painted lines while a refetch is in flight — [] would blank Live & Connected.
    if (isLoading && numbers.length === 0) return
    if (
      numbers.length === 0 &&
      prevNumbersRef.current.length > 0 &&
      isWorkspaceOrgStubId(activeOrganizationId)
    ) {
      return
    }
    if (numbersUnchanged(prevNumbersRef.current, numbers)) return
    prevNumbersRef.current = numbers
    setBusinessNumbers(numbers)
  }, [hasBootstrap, isLoading, numbers, activeOrganizationId, setBusinessNumbers])

  useEffect(() => {
    if (hasBootstrap) {
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
  }, [hasBootstrap, dashboardMainBootstrapPromise, isLoading, phoneLinesPromise, setBusinessNumbersLoading])

  useEffect(() => {
    if (hasBootstrap) return
    const next = resolveActiveLineAfterNumbers(numbers, reservedNumber, activeLine)
    // Digits-equal is enough — string inequality alone reintroduced #185 flip-flops.
    if (next === activeLine) return
    if (next && activeLine && businessNumbersMatch(next, activeLine)) return
    setActiveLine(next)
  }, [hasBootstrap, numbers, reservedNumber, activeLine, setActiveLine])

  useEffect(() => {
    const onChanged = () => {
      void mutate()
    }
    window.addEventListener("zing-business-numbers-changed", onChanged)
    return () => window.removeEventListener("zing-business-numbers-changed", onChanged)
  }, [mutate])

  return null
}
