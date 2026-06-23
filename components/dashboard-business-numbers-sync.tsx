"use client"

import { useEffect, useRef } from "react"
import { useDashboardWorkspace } from "@/components/dashboard-workspace-context"
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
    setActiveLine,
  } = useDashboardWorkspace()

  const { phoneLinesPromise } = useDashboardStream()
  const { numbers, reservedNumber, isLoading, mutate } = useBusinessNumbersQuery(activeOrganizationId)
  const prevNumbersRef = useRef(numbers)

  useEffect(() => {
    if (numbersUnchanged(prevNumbersRef.current, numbers)) return
    prevNumbersRef.current = numbers
    setBusinessNumbers(numbers)
  }, [numbers, setBusinessNumbers])

  useEffect(() => {
    if (phoneLinesPromise) {
      if (!isLoading) setBusinessNumbersLoading(false)
      return
    }
    setBusinessNumbersLoading(isLoading)
  }, [isLoading, phoneLinesPromise, setBusinessNumbersLoading])

  useEffect(() => {
    setActiveLine((prev) => {
      const next = resolveActiveLineAfterNumbers(numbers, reservedNumber, prev)
      return next === prev ? prev : next
    })
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
