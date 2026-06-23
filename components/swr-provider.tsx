"use client"

import { SWRConfig } from "swr"
import type { ReactNode } from "react"
import { defaultSwrConfig } from "@/lib/swr/config"
import { swrJsonFetcher } from "@/lib/swr/fetcher"

export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        ...defaultSwrConfig,
        fetcher: swrJsonFetcher,
      }}
    >
      {children}
    </SWRConfig>
  )
}
