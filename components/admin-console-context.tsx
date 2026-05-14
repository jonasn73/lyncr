"use client"

import { createContext, useContext, useMemo, useState } from "react"

export type AdminConsoleSection = "overview" | "users" | "support" | "advanced"

type Ctx = { section: AdminConsoleSection; setSection: (s: AdminConsoleSection) => void }

const AdminConsoleContext = createContext<Ctx | null>(null)

export function AdminConsoleProvider({ children }: { children: React.ReactNode }) {
  const [section, setSection] = useState<AdminConsoleSection>("overview")
  const value = useMemo(() => ({ section, setSection }), [section])
  return <AdminConsoleContext.Provider value={value}>{children}</AdminConsoleContext.Provider>
}

export function useAdminConsoleSection(): Ctx {
  const v = useContext(AdminConsoleContext)
  if (!v) throw new Error("useAdminConsoleSection must be used inside AdminConsoleProvider")
  return v
}
