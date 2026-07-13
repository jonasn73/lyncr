"use client"

// Shared account presence for Lines — Presence bar + call-flow cards stay in sync.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { PresenceStatus } from "@/lib/account-presence"
import { useToast } from "@/hooks/use-toast"

type AccountPresenceContextValue = {
  presenceStatus: PresenceStatus
  loading: boolean
  saving: boolean
  /** True when cell ring is skipped (On-Job or Closed). */
  presenceBypass: boolean
  setPresenceStatus: (next: PresenceStatus) => Promise<void>
  refresh: () => Promise<void>
}

const AccountPresenceContext = createContext<AccountPresenceContextValue | null>(null)

export function AccountPresenceProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const [presenceStatus, setStatus] = useState<PresenceStatus>("AVAILABLE")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/routing/presence", { credentials: "include" })
      const json = (await res.json()) as { data?: { presence_status?: string } }
      const raw = String(json.data?.presence_status || "AVAILABLE").toUpperCase()
      if (raw === "ON_JOB") setStatus("ON_JOB")
      else if (raw === "CLOSED") setStatus("CLOSED")
      else setStatus("AVAILABLE")
    } catch {
      setStatus("AVAILABLE")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setPresenceStatus = useCallback(
    async (next: PresenceStatus) => {
      const prev = presenceStatus
      setStatus(next)
      setSaving(true)
      try {
        const res = await fetch("/api/routing/presence", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presence_status: next }),
        })
        const json = (await res.json()) as {
          error?: string
          migration?: string
          data?: { presence_status?: string }
        }
        if (!res.ok) {
          setStatus(prev)
          toast({
            title: "Could not update presence",
            description: json.migration
              ? `Run ${json.migration} in Neon, then try again.`
              : json.error || res.statusText,
            variant: "destructive",
          })
          return
        }
        const saved = String(json.data?.presence_status || next).toUpperCase()
        if (saved === "ON_JOB") setStatus("ON_JOB")
        else if (saved === "CLOSED") setStatus("CLOSED")
        else setStatus("AVAILABLE")
      } catch (e) {
        setStatus(prev)
        toast({
          title: "Could not update presence",
          description: e instanceof Error ? e.message : "Try again.",
          variant: "destructive",
        })
      } finally {
        setSaving(false)
      }
    },
    [presenceStatus, toast]
  )

  const value = useMemo<AccountPresenceContextValue>(
    () => ({
      presenceStatus,
      loading,
      saving,
      presenceBypass: presenceStatus === "ON_JOB" || presenceStatus === "CLOSED",
      setPresenceStatus,
      refresh,
    }),
    [presenceStatus, loading, saving, setPresenceStatus, refresh]
  )

  return (
    <AccountPresenceContext.Provider value={value}>{children}</AccountPresenceContext.Provider>
  )
}

export function useAccountPresence(): AccountPresenceContextValue {
  const ctx = useContext(AccountPresenceContext)
  if (!ctx) {
    return {
      presenceStatus: "AVAILABLE",
      loading: false,
      saving: false,
      presenceBypass: false,
      setPresenceStatus: async () => {},
      refresh: async () => {},
    }
  }
  return ctx
}
