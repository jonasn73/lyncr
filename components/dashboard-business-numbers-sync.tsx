"use client"

import { useEffect } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
import {
  resolveActiveLineAfterNumbers,
  useBusinessNumbersQuery,
} from "@/lib/hooks/use-business-numbers-query"

/** Keeps workspace context in sync with the SWR business-numbers cache. */
export function DashboardBusinessNumbersSync() {
  const {
    activeOrganizationId,
    setBusinessNumbers,
    setBusinessNumbersLoading,
    setActiveLine,
  } = useDashboardWorkspace()

  const { numbers, reservedNumber, isLoading, mutate } = useBusinessNumbersQuery(activeOrganizationId)

  useEffect(() => {
    setBusinessNumbers(numbers)
  }, [numbers, setBusinessNumbers])

  useEffect(() => {
    setBusinessNumbersLoading(isLoading)
  }, [isLoading, setBusinessNumbersLoading])

  useEffect(() => {
    setActiveLine((prev) => resolveActiveLineAfterNumbers(numbers, reservedNumber, prev))
  }, [numbers, reservedNumber, setActiveLine])

  useEffect(() => {
    const onChanged = () => {
      void mutate()
    }
    window.addEventListener("zing-business-numbers-changed", onChanged)
    return () => window.removeEventListener("zing-business-numbers-changed", onChanged)
  }, [mutate])

  return null
}
